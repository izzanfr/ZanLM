import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, strFromU8, unzipSync, zipSync, type Zippable } from "fflate";
import { isPptxXmlPart, readPptxStructure } from "../lib/jobs/pptx.ts";
import { readZipEntries } from "../lib/jobs/zip.ts";
import type { Block } from "../lib/gemini/schema.ts";
import { EMU_PER_POINT, layoutSlide, SLIDE_16_9, type Measurer, type Rect } from "../lib/layout.ts";
import {
  escapeXml,
  highestShapeId,
  insertShapes,
  writeSourceDeck,
} from "../lib/export/source-deck.ts";

// Everything is assembled here; nothing in samples/ is read.

const PRESENTATION_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const SLIDE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";

const measure: Measurer = { width: (text) => text.length * 0.5, lineFactor: () => 1.2 };
const AREA: Rect = {
  xEmu: 0,
  yEmu: 0,
  widthEmu: SLIDE_16_9.widthEmu,
  heightEmu: SLIDE_16_9.heightEmu,
};

const block = (over: Partial<Block> = {}): Block => ({
  text: "Halo",
  box_2d: [100, 100, 200, 500],
  lines: 1,
  role: "body",
  family: "sans",
  weight: "regular",
  italic: false,
  color: "#142B4A",
  align: "left",
  confident: true,
  ...over,
});

function slideXml(shapes: string, hidden = false): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"` +
    `${hidden ? ' show="0"' : ""}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`
  );
}

const picture =
  `<p:pic><p:nvPicPr><p:cNvPr id="7" name="Picture 1"/></p:nvPicPr>` +
  `<p:blipFill><a:blip r:embed="rId1"/></p:blipFill><p:spPr><a:xfrm>` +
  `<a:off x="0" y="0"/><a:ext cx="${SLIDE_16_9.widthEmu}" cy="${SLIDE_16_9.heightEmu}"/>` +
  `</a:xfrm></p:spPr></p:pic>`;

/** Two slides, both a single full-bleed picture, the second one hidden. */
function buildDeck(): Uint8Array {
  const files: Zippable = {};
  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0"?><Types xmlns="ct">` +
      `<Override PartName="/ppt/presentation.xml" ContentType="${PRESENTATION_TYPE}"/>` +
      `<Override PartName="/ppt/slides/slide1.xml" ContentType="slide"/>` +
      `<Override PartName="/ppt/slides/slide2.xml" ContentType="slide"/></Types>`,
  );
  files["ppt/presentation.xml"] = strToU8(
    `<?xml version="1.0"?><p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>` +
      `<p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>` +
      `<p:sldSz cx="${SLIDE_16_9.widthEmu}" cy="${SLIDE_16_9.heightEmu}"/></p:presentation>`,
  );
  files["ppt/_rels/presentation.xml.rels"] = strToU8(
    `<?xml version="1.0"?><Relationships xmlns="rel">` +
      `<Relationship Id="rId1" Type="${SLIDE_REL}" Target="slides/slide1.xml"/>` +
      `<Relationship Id="rId2" Type="${SLIDE_REL}" Target="slides/slide2.xml"/></Relationships>`,
  );
  for (const [index, name] of ["slide1.xml", "slide2.xml"].entries()) {
    files[`ppt/slides/${name}`] = strToU8(slideXml(picture, index === 1));
    files[`ppt/slides/_rels/${name}.rels`] = strToU8(
      `<?xml version="1.0"?><Relationships xmlns="rel">` +
        `<Relationship Id="rId1" Type="${IMAGE_REL}" Target="../media/image${index + 1}.png"/>` +
        `</Relationships>`,
    );
    files[`ppt/media/image${index + 1}.png`] = new Uint8Array([0x89, 0x50, 0x4e, 0x47, index]);
  }
  files["ppt/notesSlides/notes1.xml"] = strToU8("<notes/>");
  return zipSync(files);
}

function deckOf(archive: Uint8Array) {
  return readPptxStructure(readZipEntries(archive, isPptxXmlPart));
}

function exported(blocks: Block[], options: { coverPatches: boolean } = { coverPatches: true }) {
  const original = buildDeck();
  const deck = deckOf(original);
  const layout = layoutSlide(blocks, AREA, SLIDE_16_9, measure, options);
  const result = writeSourceDeck(original, deck, [{ index: 1, layout }]);
  const entries = unzipSync(result.archive);
  return {
    original,
    deck,
    layout,
    result,
    entries,
    xml: strFromU8(entries["ppt/slides/slide1.xml"]),
  };
}

test("text boxes and patches are added above the picture, with fresh ids", () => {
  const { xml, result } = exported([
    block(),
    block({ text: "Kedua", box_2d: [300, 100, 400, 500] }),
  ]);
  assert.equal(result.slidesWritten, 1);
  assert.equal(result.shapesWritten, 4, "two patches and two text boxes");

  assert.ok(
    xml.indexOf("<p:pic>") < xml.indexOf("Cover patch 01"),
    "patches sit above the picture",
  );
  assert.ok(
    xml.indexOf("Cover patch 02") < xml.indexOf("Text 01"),
    "and every patch below the text",
  );
  assert.ok(xml.endsWith("</p:spTree></p:cSld></p:sld>"), "the shape tree is closed properly");

  const ids = [...xml.matchAll(/<p:cNvPr[^>]*\sid="(\d+)"/g)].map((match) => Number(match[1]));
  assert.equal(new Set(ids).size, ids.length, "no id is used twice");
  assert.ok(Math.min(...ids.filter((id) => id !== 7)) > 7, "new ids start above the picture's");
});

test("every shape carries the name it should have in the Selection pane", () => {
  const { xml } = exported([block({ role: "title" })]);
  assert.ok(xml.includes('name="Cover patch 01"'));
  assert.ok(xml.includes('name="Text 01 - title"'));
});

test("the offsets and extents are exactly what the layout computed", () => {
  const { xml, layout } = exported([block({ text: "Dua\nbaris", lines: 2 })]);
  const laid = layout.blocks[0];
  assert.ok(
    xml.includes(`<a:off x="${laid.rect.xEmu}" y="${laid.rect.yEmu}"/>`),
    "the text box offset",
  );
  assert.ok(
    xml.includes(`<a:ext cx="${laid.rect.widthEmu}" cy="${laid.rect.heightEmu}"/>`),
    "and its extent",
  );
  assert.ok(xml.includes(`<a:off x="${laid.patch!.xEmu}" y="${laid.patch!.yEmu}"/>`));
  // The height really is the computed one, not the detected one.
  const needed = laid.sizePt * 2 * measure.lineFactor("Arial") * EMU_PER_POINT;
  assert.ok(laid.rect.heightEmu >= needed);
});

test("runs become real runs, with their own weight, italic and colour", () => {
  const { xml } = exported([
    block({
      text: "Kondisi: kering",
      runs: [
        { text: "Kondisi:", weight: "bold", italic: false, color: "#FFFFFF" },
        { text: " kering", weight: "regular", italic: true, color: "#AABBCC" },
      ],
    }),
  ]);
  assert.ok(xml.includes('b="1" i="0"'), "the bold label");
  assert.ok(xml.includes('b="0" i="1"'), "and the italic rest");
  assert.ok(xml.includes('<a:srgbClr val="FFFFFF"/>'));
  assert.ok(xml.includes('<a:srgbClr val="AABBCC"/>'));
  assert.ok(xml.includes("<a:t>Kondisi:</a:t>"));
  assert.ok(xml.includes("<a:t> kering</a:t>"));
  assert.ok(xml.includes('typeface="Arial"'));
});

test("a line break becomes a new paragraph, not a new box", () => {
  const { xml } = exported([block({ text: "Satu\nDua", lines: 2 })]);
  const paragraphs = [...xml.matchAll(/<a:p>/g)].length;
  assert.ok(paragraphs >= 2, "two paragraphs for two lines");
  assert.ok(xml.includes("<a:t>Satu</a:t>") && xml.includes("<a:t>Dua</a:t>"));
  assert.equal([...xml.matchAll(/txBox="1"/g)].length, 1, "still one text box");
});

test("everything else in the package is copied byte for byte", () => {
  const { original, entries } = exported([block()]);
  const before = unzipSync(original);
  for (const name of Object.keys(before)) {
    if (name === "ppt/slides/slide1.xml") continue;
    assert.deepEqual(entries[name], before[name], `${name} changed`);
  }
  assert.deepEqual(
    Object.keys(entries).sort(),
    Object.keys(before).sort(),
    "no part added or lost",
  );
  // The hidden slide keeps its flag and its content.
  assert.ok(strFromU8(entries["ppt/slides/slide2.xml"]).includes('show="0"'));
});

test("a cleaned background replaces the picture bytes, and only those", () => {
  const original = buildDeck();
  const deck = deckOf(original);
  const layout = layoutSlide([block()], AREA, SLIDE_16_9, measure, { coverPatches: false });
  const cleaned = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 99]);
  const { archive } = writeSourceDeck(original, deck, [{ index: 1, layout, picture: cleaned }]);
  const entries = unzipSync(archive);
  assert.deepEqual(entries["ppt/media/image1.png"], cleaned);
  assert.deepEqual(entries["ppt/media/image2.png"], unzipSync(original)["ppt/media/image2.png"]);
});

test("patches can be turned off, and then only text boxes are written", () => {
  const { xml, result } = exported([block()], { coverPatches: false });
  assert.equal(result.shapesWritten, 1);
  assert.ok(!xml.includes("Cover patch"));
});

test("a patch takes the colour it was given", () => {
  const original = buildDeck();
  const deck = deckOf(original);
  const layout = layoutSlide([block()], AREA, SLIDE_16_9, measure, { coverPatches: true });
  const { archive } = writeSourceDeck(original, deck, [
    { index: 1, layout, patchColors: ["1A2B3C"] },
  ]);
  assert.ok(strFromU8(unzipSync(archive)["ppt/slides/slide1.xml"]).includes('val="1A2B3C"'));
});

test("a slide with no detection is left exactly as it was", () => {
  const original = buildDeck();
  const deck = deckOf(original);
  const { archive, slidesWritten } = writeSourceDeck(original, deck, []);
  assert.equal(slidesWritten, 0);
  const entries = unzipSync(archive);
  const before = unzipSync(original);
  for (const name of Object.keys(before)) assert.deepEqual(entries[name], before[name]);
});

test("text from the slide is escaped, never written as markup", () => {
  const nasty = "</a:t></a:r></p:txBody><script>&\"'";
  const { xml } = exported([block({ text: nasty })]);
  assert.ok(!xml.includes("<script>"), "no markup slips in");
  assert.ok(xml.includes(escapeXml(nasty)));
  // The slide still parses as one shape tree with the expected shape count.
  assert.equal([...xml.matchAll(/<\/p:spTree>/g)].length, 1);
});

test("shape ids and insertion are handled on their own terms", () => {
  assert.equal(highestShapeId('<p:cNvPr id="4"/><p:cNvPr name="x" id="19"/>'), 19);
  assert.equal(highestShapeId("<p:cNvPr/>"), 1, "a slide with no ids still starts above zero");
  assert.equal(insertShapes(slideXml(""), []), slideXml(""), "nothing to add changes nothing");
  assert.throws(() => insertShapes("<p:sld/>", ["<p:sp/>"]), /shape tree/);
});
