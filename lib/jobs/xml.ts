import { XMLParser } from "fast-xml-parser";

export class XmlRejectedError extends Error {
  constructor(reason: string) {
    super(`xml rejected: ${reason}`);
    this.name = "XmlRejectedError";
  }
}

// fast-xml-parser refuses external entities itself ("External entities are not
// supported"), but with the default options it does expand entities declared in
// an internal DOCTYPE subset, which is the billion-laughs shape. Office never
// writes a DOCTYPE into OOXML, so any document that carries one is rejected
// before it reaches the parser. That also removes the only way to declare an
// entity at all, which is why standard entity decoding can stay on and notes
// text still comes out as it was typed.
const FORBIDDEN = /<!\s*(DOCTYPE|ENTITY|NOTATION)\b/i;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  allowBooleanAttributes: true,
  // Slide text is copied exactly: no trimming, and no guessing that "007" or
  // "1.20" is a number.
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  // Needed for numeric character references: without it "&#233;" survives as
  // literal text and a slide's notes come out mangled. "&amp;#233;" still
  // decodes to the text "&#233;", so nothing is decoded twice.
  htmlEntities: true,
});

export type XmlNode = Record<string, unknown>;

export function parseXml(text: string): XmlNode {
  if (FORBIDDEN.test(text)) throw new XmlRejectedError("doctype or entity declaration");
  try {
    return parser.parse(text) as XmlNode;
  } catch (error) {
    throw new XmlRejectedError(error instanceof Error ? error.message : "unparsable");
  }
}

export function decodeXml(bytes: Uint8Array): XmlNode {
  return parseXml(new TextDecoder("utf-8").decode(bytes));
}

function isNode(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An element that occurs once is an object, twice is an array; this hides that. */
export function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function child(node: unknown, name: string): XmlNode | undefined {
  if (!isNode(node)) return undefined;
  const first = toArray(node[name])[0];
  return isNode(first) ? first : undefined;
}

export function attribute(node: unknown, name: string): string | undefined {
  if (!isNode(node)) return undefined;
  const value = node[`@_${name}`];
  return typeof value === "string" ? value : undefined;
}

/**
 * Every descendant value stored under this tag name, in document order,
 * including ones nested in group shapes. Values are not always objects: an
 * element with no attributes and only text parses to a plain string, and an
 * empty element to "". Depth is bounded so a deeply nested document cannot
 * overflow the stack.
 */
export function findAll(root: unknown, tag: string, maxDepth = 64): unknown[] {
  const found: unknown[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > maxDepth || !isNode(node)) return;
    for (const [key, value] of Object.entries(node)) {
      for (const item of toArray(value)) {
        if (key === tag) found.push(item);
        visit(item, depth + 1);
      }
    }
  };
  visit(root, 0);
  return found;
}

export function findElements(root: unknown, tag: string, maxDepth = 64): XmlNode[] {
  return findAll(root, tag, maxDepth).filter(isNode);
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (isNode(value) && typeof value["#text"] === "string") return value["#text"];
  return "";
}

/** Concatenated text of every `a:t` under this node, which is how OOXML stores runs. */
export function textOf(node: unknown): string {
  return findAll(node, "a:t").map(textValue).join("");
}

/** One string per `a:p` paragraph, in document order. */
export function paragraphsOf(node: unknown): string[] {
  return findAll(node, "a:p").map(textOf);
}
