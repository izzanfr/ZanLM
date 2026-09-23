/**
 * The writer for PPTX jobs (decision 1B): it copies the uploaded package and
 * adds, on each image-only slide, the cover patches and the native text boxes
 * above the picture. Masters, layouts, notes, hidden flags, transitions and
 * every mixed slide are copied through untouched, and no part is added, so
 * `[Content_Types].xml` does not change either.
 *
 * The shapes are written as XML text rather than through the read-only parser,
 * because the parser does not round-trip a slide and the rest of the file must
 * stay exactly as it was.
 */

import { unzipSync, zipSync } from "fflate";
import type { LaidOutBlock, Rect, SlideLayout } from "../layout.ts";
import { EMU_PER_POINT } from "../layout.ts";
import type { PptxDeck } from "../jobs/pptx.ts";
import { PptxError } from "../jobs/pptx.ts";
import { zipEntryNames, ZIP_LIMITS } from "../jobs/zip.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** The five characters XML cannot carry literally inside an element or value. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** OOXML wants a bare six-digit hex colour, upper case. */
function colorValue(color: string): string {
  const hex = color.startsWith("#") ? color.slice(1) : color;
  return hex.toUpperCase();
}

function xfrm(rect: Rect): string {
  return (
    `<a:xfrm><a:off x="${Math.round(rect.xEmu)}" y="${Math.round(rect.yEmu)}"/>` +
    `<a:ext cx="${Math.round(rect.widthEmu)}" cy="${Math.round(rect.heightEmu)}"/></a:xfrm>`
  );
}

/** A filled rectangle that hides what is under the text in the picture. */
export function patchShape(id: number, name: string, rect: Rect, color: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(rect)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${colorValue(color)}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`
  );
}

const ALIGNMENT = { left: "l", center: "ctr", right: "r" } as const;

/** One native text box, with a real run per detected run. */
export function textShape(id: number, name: string, laid: LaidOutBlock): string {
  const size = Math.round(laid.sizePt * 100); // OOXML counts hundredths of a point
  const paragraphs = laid.lines
    .map((line) => {
      const runs = line
        .map(
          (run) =>
            `<a:r><a:rPr lang="en-US" sz="${size}" b="${run.weight === "bold" ? 1 : 0}"` +
            ` i="${run.italic ? 1 : 0}" dirty="0">` +
            `<a:solidFill><a:srgbClr val="${colorValue(run.color)}"/></a:solidFill>` +
            `<a:latin typeface="${escapeXml(laid.face)}"/></a:rPr>` +
            `<a:t>${escapeXml(run.text)}</a:t></a:r>`,
        )
        .join("");
      return `<a:p><a:pPr algn="${ALIGNMENT[laid.block.align]}"/>${runs}</a:p>`;
    })
    .join("");
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/>` +
    `<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(laid.rect)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="${Math.round(laid.sizePt * 0.1 * EMU_PER_POINT)}"` +
    ` rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`
  );
}

/** The largest shape id already in a slide, so new shapes cannot collide. */
export function highestShapeId(slideXml: string): number {
  let highest = 1;
  for (const match of slideXml.matchAll(/<p:cNvPr[^>]*\sid="(\d+)"/g)) {
    highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

/** The shapes of one slide, inserted at the end of its shape tree. */
export function insertShapes(slideXml: string, shapes: string[]): string {
  if (shapes.length === 0) return slideXml;
  const close = slideXml.lastIndexOf("</p:spTree>");
  if (close < 0) throw new PptxError("slide has no shape tree");
  return slideXml.slice(0, close) + shapes.join("") + slideXml.slice(close);
}

export type SlideExport = {
  /** Index in the deck, matching PptxSlide.index. */
  index: number;
  layout: SlideLayout;
  /** The background picture to put in place of the original, if it changed. */
  picture?: Uint8Array;
  /** Patch colours, one per block, as six hex digits. White where missing. */
  patchColors?: readonly string[];
};

export type ExportResult = { archive: Uint8Array; slidesWritten: number; shapesWritten: number };

/**
 * Writes the deck. `exports` holds only the slides that got a detection;
 * every other slide, mixed ones included, is copied as it is (decision 7A, so
 * a job with failed slides still produces a file).
 */
export function writeSourceDeck(
  original: Uint8Array,
  deck: PptxDeck,
  exports: readonly SlideExport[],
): ExportResult {
  // The archive has already been through the guarded reader on upload, which
  // is where a zip bomb is stopped; the entry count is checked again here so
  // this function is not a way around that limit.
  if (zipEntryNames(original).length > ZIP_LIMITS.maxEntries) {
    throw new PptxError("too many entries");
  }
  const entries = unzipSync(original);
  const byIndex = new Map(exports.map((one) => [one.index, one]));
  let slidesWritten = 0;
  let shapesWritten = 0;

  for (const slide of deck.slides) {
    const wanted = byIndex.get(slide.index);
    if (!wanted) continue;
    const part = entries[slide.part];
    if (!part) throw new PptxError(`slide part missing: ${slide.part}`);

    if (wanted.picture && slide.picture) {
      entries[slide.picture] = Uint8Array.from(wanted.picture);
    }

    const shapes: string[] = [];
    let id = highestShapeId(decoder.decode(part));
    // Patches first, so every text box sits above every patch.
    wanted.layout.blocks.forEach((laid, position) => {
      if (!laid.patch) return;
      id += 1;
      shapes.push(
        patchShape(
          id,
          `Cover patch ${String(position + 1).padStart(2, "0")}`,
          laid.patch,
          wanted.patchColors?.[position] ?? "FFFFFF",
        ),
      );
    });
    wanted.layout.blocks.forEach((laid, position) => {
      id += 1;
      const name = `Text ${String(position + 1).padStart(2, "0")} - ${laid.block.role}`;
      shapes.push(textShape(id, name, laid));
    });

    entries[slide.part] = encoder.encode(insertShapes(decoder.decode(part), shapes));
    slidesWritten += 1;
    shapesWritten += shapes.length;
  }

  return { archive: zipSync(entries), slidesWritten, shapesWritten };
}
