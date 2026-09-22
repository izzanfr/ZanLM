import {
  attribute,
  child,
  decodeXml,
  findElements,
  paragraphsOf,
  parseXml,
  textOf,
  toArray,
  type XmlNode,
} from "./xml.ts";

export class PptxError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`pptx rejected: ${reason}`);
    this.name = "PptxError";
    this.reason = reason;
  }
}

const PRESENTATION_TYPES = [
  "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml",
  "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml",
];

const IMAGE_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const SLIDE_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const NOTES_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";

/**
 * A name that could be read as climbing out of the package. Such a name is
 * never a real OOXML part, and since no name from the archive is ever used as
 * a write path this is tidiness rather than the defence itself, but it keeps
 * the rule simple: names like this are not parts and are never inflated.
 */
export function isTraversalName(name: string): boolean {
  return (
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[a-z]:/i.test(name) ||
    name.split("/").includes("..")
  );
}

/** The parts needed to work out the deck structure. Media is fetched separately. */
export function isPptxXmlPart(name: string): boolean {
  if (isTraversalName(name)) return false;
  if (name === "[Content_Types].xml") return true;
  if (name === "ppt/presentation.xml") return true;
  if (name === "ppt/_rels/presentation.xml.rels") return true;
  if (name.startsWith("ppt/slides/") && name.endsWith(".xml")) return true;
  if (name.startsWith("ppt/slides/_rels/") && name.endsWith(".rels")) return true;
  if (name.startsWith("ppt/notesSlides/") && name.endsWith(".xml")) return true;
  if (name.startsWith("ppt/notesSlides/_rels/") && name.endsWith(".rels")) return true;
  return false;
}

/**
 * Resolves a relationship target against the part that declared it. This walks
 * names inside the archive, never the file system, and returns null for
 * anything that would leave the package or point somewhere external.
 */
export function resolvePart(basePart: string, target: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const baseDirectory = basePart.slice(0, basePart.lastIndexOf("/"));
  const combined = target.startsWith("/") ? target.slice(1) : `${baseDirectory}/${target}`;
  const parts: string[] = [];
  for (const segment of combined.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

type Relationship = { type: string; target: string };

function readRelationships(
  entries: Map<string, Uint8Array>,
  partName: string,
): Map<string, Relationship> {
  const index = partName.lastIndexOf("/");
  const relsName = `${partName.slice(0, index)}/_rels/${partName.slice(index + 1)}.rels`;
  const bytes = entries.get(relsName);
  const map = new Map<string, Relationship>();
  if (!bytes) return map;
  const root = child(decodeXml(bytes), "Relationships");
  for (const relationship of findElements(root, "Relationship")) {
    const id = attribute(relationship, "Id");
    const target = attribute(relationship, "Target");
    const type = attribute(relationship, "Type") ?? "";
    // External targets are references to the network or another file. We only
    // ever read parts that live inside this archive.
    if (!id || !target || attribute(relationship, "TargetMode") === "External") continue;
    const resolved = resolvePart(partName, target);
    if (resolved) map.set(id, { type, target: resolved });
  }
  return map;
}

function emu(node: XmlNode | undefined, name: string): number {
  const raw = attribute(node, name);
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

type Rect = { x: number; y: number; width: number; height: number };

function pictureRect(picture: XmlNode): Rect | null {
  const transform = child(child(picture, "p:spPr"), "a:xfrm");
  if (!transform) return null;
  const offset = child(transform, "a:off");
  const extent = child(transform, "a:ext");
  if (!extent) return null;
  return {
    x: emu(offset, "x"),
    y: emu(offset, "y"),
    width: emu(extent, "cx"),
    height: emu(extent, "cy"),
  };
}

/** How much of the slide the picture actually covers, ignoring the part off-slide. */
export function slideCoverage(rect: Rect | null, width: number, height: number): number {
  if (!rect || width <= 0 || height <= 0 || rect.width <= 0 || rect.height <= 0) return 0;
  const visibleWidth = Math.max(0, Math.min(rect.x + rect.width, width) - Math.max(rect.x, 0));
  const visibleHeight = Math.max(0, Math.min(rect.y + rect.height, height) - Math.max(rect.y, 0));
  return (visibleWidth * visibleHeight) / (width * height);
}

/** Below this, the picture is not the whole slide and the slide counts as mixed. */
export const FULL_SLIDE_COVERAGE = 0.98;

export type PptxSlide = {
  index: number;
  part: string;
  /** Archive entry name of the chosen picture, or null when the slide has none. */
  picture: string | null;
  /** Not a single full-slide picture: keep its native text and shapes in T3. */
  mixed: boolean;
  hidden: boolean;
  notes: string | null;
};

export type PptxDeck = {
  widthEmu: number;
  heightEmu: number;
  slides: PptxSlide[];
};

function assertPresentation(entries: Map<string, Uint8Array>): void {
  const contentTypes = entries.get("[Content_Types].xml");
  if (!contentTypes) throw new PptxError("no content types");
  const root = child(decodeXml(contentTypes), "Types");
  const declared = findElements(root, "Override").some((override) =>
    PRESENTATION_TYPES.includes(attribute(override, "ContentType") ?? ""),
  );
  if (!declared) throw new PptxError("not a presentation");
  if (!entries.has("ppt/presentation.xml")) throw new PptxError("no presentation part");
}

// OOXML stores a line break as its own element next to the text runs, and the
// parser turns sibling elements into one array per tag name, so the position of
// a break relative to the runs is lost. Rewriting each break into an `a:r` run
// holding a newline puts it back in the run array at the right index. This runs
// on the notes part only, and only after parseXml has already accepted it.
const BREAK_AS_RUN = "<a:r><a:t>\n</a:t></a:r>";

function withLineBreaks(xml: string): string {
  return xml
    .replace(/<a:br\b[^>]*\/>/g, BREAK_AS_RUN)
    .replace(/<a:br\b[^>]*>[\s\S]*?<\/a:br>/g, BREAK_AS_RUN);
}

function readNotes(entries: Map<string, Uint8Array>, part: string): string | null {
  const bytes = entries.get(part);
  if (!bytes) return null;
  const text = new TextDecoder("utf-8").decode(bytes);
  // Parse once to apply the DOCTYPE and entity rules, then again with breaks
  // turned into runs. The second parse sees the same, already accepted markup.
  parseXml(text);
  const tree = child(child(parseXml(withLineBreaks(text)), "p:notes"), "p:cSld");
  const shapeTree = child(tree, "p:spTree");
  if (!shapeTree) return null;

  const paragraphs: string[] = [];
  for (const shape of findElements(shapeTree, "p:sp")) {
    const placeholder = child(child(child(shape, "p:nvSpPr"), "p:nvPr"), "p:ph");
    const kind = attribute(placeholder, "type");
    // The slide image and the page number are not speaker notes.
    if (kind === "sldNum" || kind === "sldImg" || kind === "dt") continue;
    paragraphs.push(...paragraphsOf(shape));
  }

  // Text is copied exactly; only empty leading and trailing paragraphs go.
  while (paragraphs.length > 0 && paragraphs[0].trim() === "") paragraphs.shift();
  while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1].trim() === "") paragraphs.pop();
  const notes = paragraphs.join("\n");
  return notes.trim() === "" ? null : notes;
}

export function readPptxStructure(entries: Map<string, Uint8Array>): PptxDeck {
  assertPresentation(entries);
  const presentationPart = "ppt/presentation.xml";
  const presentation = child(decodeXml(entries.get(presentationPart)!), "p:presentation");
  const size = child(presentation, "p:sldSz");
  const widthEmu = emu(size, "cx") || 12192000;
  const heightEmu = emu(size, "cy") || 6858000;

  const relationships = readRelationships(entries, presentationPart);
  const list = child(presentation, "p:sldIdLst");
  const slides: PptxSlide[] = [];
  let index = 0;
  for (const entry of toArray(list?.["p:sldId"])) {
    const id = attribute(entry, "r:id");
    const relationship = id ? relationships.get(id) : undefined;
    if (!relationship || relationship.type !== SLIDE_RELATIONSHIP) continue;
    index += 1;
    slides.push(readSlideWithGeometry(entries, relationship.target, index, widthEmu, heightEmu));
  }
  if (slides.length === 0) throw new PptxError("no slides");
  return { widthEmu, heightEmu, slides };
}

function readSlideWithGeometry(
  entries: Map<string, Uint8Array>,
  part: string,
  index: number,
  widthEmu: number,
  heightEmu: number,
): PptxSlide {
  const bytes = entries.get(part);
  if (!bytes) throw new PptxError("missing slide part");
  const document = decodeXml(bytes);
  const slide = child(document, "p:sld");
  const shapeTree = child(child(slide, "p:cSld"), "p:spTree");
  const relationships = readRelationships(entries, part);

  const pictures = shapeTree ? findElements(shapeTree, "p:pic") : [];
  let picture: string | null = null;
  let coverage = 0;
  for (const candidate of pictures) {
    const embed = attribute(child(child(candidate, "p:blipFill"), "a:blip"), "r:embed");
    const relationship = embed ? relationships.get(embed) : undefined;
    if (!relationship || relationship.type !== IMAGE_RELATIONSHIP) continue;
    const candidateCoverage = slideCoverage(pictureRect(candidate), widthEmu, heightEmu);
    if (picture === null || candidateCoverage > coverage) {
      picture = relationship.target;
      coverage = candidateCoverage;
    }
  }

  // Anything beyond one full-bleed picture means the slide carries native
  // content of its own: more pictures, a group, or any non-empty text.
  const hasText = shapeTree ? textOf(shapeTree).trim() !== "" : false;
  const hasGroup = shapeTree ? findElements(shapeTree, "p:grpSp").length > 0 : false;
  const mixed =
    picture === null ||
    coverage < FULL_SLIDE_COVERAGE ||
    pictures.length > 1 ||
    hasText ||
    hasGroup;

  const notesEntry = [...relationships.values()].find(
    (relationship) => relationship.type === NOTES_RELATIONSHIP,
  );

  return {
    index,
    part,
    picture,
    mixed,
    hidden: attribute(slide, "show") === "0",
    notes: notesEntry ? readNotes(entries, notesEntry.target) : null,
  };
}

/** Archive entry names of the pictures the deck actually uses. */
export function pictureEntries(deck: PptxDeck): Set<string> {
  const names = new Set<string>();
  for (const slide of deck.slides) {
    if (slide.picture) names.add(slide.picture);
  }
  return names;
}
