/**
 * Where every exported element goes, in EMU, and at what size. Pure: it takes
 * the detection and a text measurer and returns numbers, so both writers (the
 * copied source deck and the new pptxgenjs deck) lay text out identically and
 * the whole thing is testable without a font file or a PPTX.
 *
 * Sections 7.1 to 7.4 of docs/T3-plan.md are implemented here.
 */

import type { Block, Run } from "./gemini/schema.ts";

/** English Metric Units: what OOXML measures everything in. */
export const EMU_PER_POINT = 12700;
export const EMU_PER_INCH = 914400;

export const SLIDE_16_9 = { widthEmu: 12192000, heightEmu: 6858000 };
export const SLIDE_4_3 = { widthEmu: 9144000, heightEmu: 6858000 };

/** How far a picture's ratio may sit from a layout's before it is letterboxed. */
export const RATIO_TOLERANCE = 0.03;

export type Rect = { xEmu: number; yEmu: number; widthEmu: number; heightEmu: number };

export type SlideSize = { widthEmu: number; heightEmu: number };

/**
 * Text measurement, so the layout never touches a font file. `width` is the
 * text's width at a size of one point, so multiplying by the size gives
 * points; `lineFactor` is one line's height as a multiple of the font size,
 * from the face's own ascent and descent.
 */
export type Measurer = {
  width(text: string, face: string, weight: "regular" | "bold", italic: boolean): number;
  lineFactor(face: string): number;
};

export const LAYOUT_DEFAULTS = {
  /** Of the box width, kept free so a line never touches the edge. */
  widthSafety: 0.15,
  /** Of the font size, added above and below the text inside its box. */
  padding: 0.1,
  /** Sizes are rounded down to this step, in points. */
  sizeStep: 0.5,
  /** No text is ever exported smaller than this. */
  minimumSize: 6,
  /** A patch reaches this far beyond its block, as a share of slide height. */
  patchPadding: 0.006,
};

/**
 * The faces of section 7.3. All of them ship with Windows. `flagged` marks a
 * family that has no safe face, so the Review page in T7 can show it.
 */
export function faceFor(
  family: Block["family"],
  weight: Block["weight"],
): { face: string; flagged: boolean } {
  switch (family) {
    case "serif":
      return { face: "Georgia", flagged: false };
    case "mono":
      return { face: "Consolas", flagged: false };
    case "display":
      // A bold display line is usually a plain heavy sans; Bahnschrift is the
      // condensed look, which would make a wide headline too narrow.
      return { face: weight === "bold" ? "Arial" : "Bahnschrift", flagged: false };
    case "handwriting":
      return { face: "Arial", flagged: true };
    default:
      return { face: "Arial", flagged: false };
  }
}

/**
 * The slide size for a deck built from pictures, and the rectangle the picture
 * is drawn in. A picture whose ratio is within the tolerance fills the slide;
 * anything else keeps its shape and gets bars (decision 3A).
 */
export function imageArea(
  image: { width: number; height: number },
  slide: SlideSize,
): { area: Rect; letterboxed: boolean } {
  const imageRatio = image.width / image.height;
  const slideRatio = slide.widthEmu / slide.heightEmu;
  const off = Math.abs(imageRatio - slideRatio) / slideRatio;
  if (off <= RATIO_TOLERANCE) {
    return {
      area: { xEmu: 0, yEmu: 0, widthEmu: slide.widthEmu, heightEmu: slide.heightEmu },
      letterboxed: false,
    };
  }
  const scale = Math.min(slide.widthEmu / image.width, slide.heightEmu / image.height);
  const widthEmu = Math.min(slide.widthEmu, Math.round(image.width * scale));
  const heightEmu = Math.min(slide.heightEmu, Math.round(image.height * scale));
  // Floor, not round, so a bar takes the odd EMU: the picture can never end up
  // one unit wider than the slide it sits on.
  return {
    area: {
      xEmu: Math.floor((slide.widthEmu - widthEmu) / 2),
      yEmu: Math.floor((slide.heightEmu - heightEmu) / 2),
      widthEmu,
      heightEmu,
    },
    letterboxed: true,
  };
}

/** The layout a deck of pictures gets: the closer of the two slide sizes. */
export function slideSizeFor(image: { width: number; height: number }): SlideSize {
  const ratio = image.width / image.height;
  const distance = (slide: SlideSize) =>
    Math.abs(ratio - slide.widthEmu / slide.heightEmu) / (slide.widthEmu / slide.heightEmu);
  return distance(SLIDE_16_9) <= distance(SLIDE_4_3) ? SLIDE_16_9 : SLIDE_4_3;
}

/** A detected box (0 to 1000, ymin xmin ymax xmax) placed inside the picture. */
export function boxToEmu(box: Block["box_2d"], area: Rect): Rect {
  const [ymin, xmin, ymax, xmax] = box;
  const clamp = (value: number) => Math.min(1000, Math.max(0, value));
  const left = clamp(Math.min(xmin, xmax));
  const right = clamp(Math.max(xmin, xmax));
  const top = clamp(Math.min(ymin, ymax));
  const bottom = clamp(Math.max(ymin, ymax));
  const xEmu = area.xEmu + Math.round((left / 1000) * area.widthEmu);
  const yEmu = area.yEmu + Math.round((top / 1000) * area.heightEmu);
  return {
    xEmu,
    yEmu,
    widthEmu: area.xEmu + Math.round((right / 1000) * area.widthEmu) - xEmu,
    heightEmu: area.yEmu + Math.round((bottom / 1000) * area.heightEmu) - yEmu,
  };
}

/** The pieces a block is written as: its runs, or the block itself as one run. */
export function runsOf(block: Block): Run[] {
  if (block.runs && block.runs.length > 0) return block.runs;
  return [{ text: block.text, weight: block.weight, italic: block.italic, color: block.color }];
}

/** The runs split into visual lines, so each line can be measured on its own. */
export function linesOf(runs: readonly Run[]): Run[][] {
  const lines: Run[][] = [[]];
  for (const run of runs) {
    const pieces = run.text.split("\n");
    pieces.forEach((piece, index) => {
      if (index > 0) lines.push([]);
      if (piece.length > 0) lines[lines.length - 1].push({ ...run, text: piece });
    });
  }
  return lines;
}

export type LaidOutBlock = {
  block: Block;
  /** Where the text box goes. Its height is computed, never detected. */
  rect: Rect;
  /** The rectangle behind it that hides the original text, or null. */
  patch: Rect | null;
  sizePt: number;
  face: string;
  lines: Run[][];
  flags: LayoutFlag[];
};

export type LayoutFlag = "size-floor" | "no-safe-face" | "low-confidence" | "moved-up";

/**
 * One block's size and box.
 *
 * The height is computed from the size, the line count and the face's real
 * metrics, and the detected box gives only position and width (owner decision
 * 2026-09-23). Every model and resolution returns boxes 7 to 13% too short,
 * and a short box clips its own text in PowerPoint. The detected height is
 * still read for the size limit, so a box that is far too short cannot make
 * the text too large.
 */
export function layoutBlock(
  block: Block,
  area: Rect,
  slide: SlideSize,
  measure: Measurer,
  options = LAYOUT_DEFAULTS,
): LaidOutBlock {
  const flags: LayoutFlag[] = [];
  const { face, flagged } = faceFor(block.family, block.weight);
  if (flagged) flags.push("no-safe-face");
  if (!block.confident) flags.push("low-confidence");

  const detected = boxToEmu(block.box_2d, area);
  const lines = linesOf(runsOf(block));
  const lineCount = Math.max(1, lines.length);
  const factor = measure.lineFactor(face);

  // 1. What the detected height allows, and 2. what the width allows. Widths
  //    scale with the size, so one measurement at a reference size is enough.
  const heightLimit = detected.heightEmu / EMU_PER_POINT / (lineCount * factor);
  const widthAvailable = (detected.widthEmu / EMU_PER_POINT) * (1 - options.widthSafety);
  const widest = Math.max(
    ...lines.map((line) =>
      line.reduce((total, run) => total + measure.width(run.text, face, run.weight, run.italic), 0),
    ),
    0,
  );
  const widthLimit = widest > 0 ? widthAvailable / widest : heightLimit;

  // 3. The smaller of the two, rounded down, with a floor.
  const wanted = Math.min(heightLimit, widthLimit);
  let sizePt = Math.floor(wanted / options.sizeStep) * options.sizeStep;
  if (sizePt < options.minimumSize) {
    sizePt = options.minimumSize;
    flags.push("size-floor");
  }

  // 4. The height the text really needs.
  const padding = sizePt * options.padding;
  const heightEmu = Math.ceil((sizePt * lineCount * factor + 2 * padding) * EMU_PER_POINT);

  // 5. The width, at least what the text measures, anchored by alignment.
  const measuredWidth = Math.ceil(widest * sizePt * 1.15 * EMU_PER_POINT);
  const widthEmu = Math.min(slide.widthEmu, Math.max(detected.widthEmu, measuredWidth));
  let xEmu = detected.xEmu;
  if (block.align === "center")
    xEmu = detected.xEmu + Math.round((detected.widthEmu - widthEmu) / 2);
  if (block.align === "right") xEmu = detected.xEmu + detected.widthEmu - widthEmu;
  xEmu = Math.min(Math.max(0, xEmu), Math.max(0, slide.widthEmu - widthEmu));

  // The top edge is the one the model places well, so the box grows downwards
  // from it; a box that would run off the slide moves up instead of shrinking.
  let yEmu = detected.yEmu;
  if (yEmu + heightEmu > slide.heightEmu) {
    yEmu = Math.max(0, slide.heightEmu - heightEmu);
    flags.push("moved-up");
  }

  const rect = { xEmu, yEmu, widthEmu, heightEmu };
  return { block, rect, patch: null, sizePt, face, lines, flags };
}

/**
 * Cover patches are off by default (owner decision 2026-09-23, after looking at
 * the first exported deck). On a textured deck a patch reads as a flat rectangle
 * whatever colour it takes, and because it is sized from the detected box, which
 * is too short, it does not even cover the original text: on the sample deck the
 * old text still showed under the new one. The option stays, but a patch built
 * from the detected box is not good enough to be the default; sizing it from the
 * text pixels themselves is the fix, and that same mask is what T4 gives LaMa.
 */
export const COVER_PATCHES_DEFAULT = false;

/** The rectangle that hides the original text under a block. */
export function patchFor(rect: Rect, slide: SlideSize, options = LAYOUT_DEFAULTS): Rect {
  const padding = Math.round(slide.heightEmu * options.patchPadding);
  const xEmu = Math.max(0, rect.xEmu - padding);
  const yEmu = Math.max(0, rect.yEmu - padding);
  return {
    xEmu,
    yEmu,
    widthEmu: Math.min(slide.widthEmu - xEmu, rect.widthEmu + 2 * padding),
    heightEmu: Math.min(slide.heightEmu - yEmu, rect.heightEmu + 2 * padding),
  };
}

export type SlideLayout = {
  area: Rect;
  blocks: LaidOutBlock[];
};

/**
 * Every block of one slide. Blocks keep the detection's order, so the shapes
 * are numbered the way the slide reads.
 */
export function layoutSlide(
  blocks: readonly Block[],
  area: Rect,
  slide: SlideSize,
  measure: Measurer,
  options: { coverPatches: boolean } & Partial<typeof LAYOUT_DEFAULTS> = {
    coverPatches: COVER_PATCHES_DEFAULT,
  },
): SlideLayout {
  const settings = { ...LAYOUT_DEFAULTS, ...options };
  return {
    area,
    blocks: blocks.map((block) => {
      const laid = layoutBlock(block, area, slide, measure, settings);
      return { ...laid, patch: options.coverPatches ? patchFor(laid.rect, slide, settings) : null };
    }),
  };
}
