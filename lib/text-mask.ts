/**
 * Which pixels of a slide are a text block's own ink, and how tall its lines
 * really are. Pure: raw pixels in, a mask and a few measurements out.
 *
 * Three things need this, and they need the same answer (docs/T4-plan.md):
 * the inpainting, which paints these pixels out of the background; the cover
 * patch, which has to be sized from the text it hides rather than from the
 * detected box; and the font size, because the detected box is the wrong
 * ruler. Boxes come back 7 to 13% too short, with a spread that made the
 * chosen size miss in both directions, so the size is measured from the ink:
 * the distance from one line of ink to the next.
 *
 * The ink itself is found by `findInk` in lib/box-refine.ts, so there is one
 * detector and one place where a rule about ornament or frame lines lives.
 */

import {
  components,
  findInk,
  REFINE_DEFAULTS,
  toPixels,
  type Box2d,
  type RawImage,
  type Rect,
  type RefineOptions,
} from "./box-refine.ts";

export type TextMaskOptions = {
  refine: RefineOptions;
  /** A row needs this share of the box's width in ink to count as a text row. */
  rowShare: number;
  /** Rows this far apart still belong to the same line, in pixels. */
  rowGap: number;
  /** Below this share of the box, the ink found is too little to trust. */
  minCoverage: number;
  /** Above it, something other than text fills the box: an ornament, a fill. */
  maxCoverage: number;
  /** Lines may differ from the median pitch by this much and still count. */
  pitchTolerance: number;
};

export const TEXT_MASK_DEFAULTS: TextMaskOptions = {
  refine: REFINE_DEFAULTS,
  rowShare: 0.02,
  rowGap: 2,
  minCoverage: 0.01,
  maxCoverage: 0.6,
  pitchTolerance: 0.35,
};

export type TextMask = {
  /** 1 where the block's ink is, over the whole image, so masks can be unioned. */
  mask: Uint8Array;
  /** The image the mask indexes into, so a bounding box can be read back. */
  imageWidth: number;
  imageHeight: number;
  /** The detected box the ink was taken from. */
  area: Rect;
  /** First and last ink row of each visual line, in image coordinates. */
  lines: Array<[number, number]>;
  /** Baseline to baseline in pixels, or null when there is only one line. */
  linePitchPx: number | null;
  /** Height of one line's ink, cap to descender, in pixels. */
  inkHeightPx: number;
  /** Share of the box that is ink. */
  coverage: number;
  /** False when the measurements are too weak to size text from. */
  confident: boolean;
  /** Why not, when it is not. */
  reason: "low-ink" | "too-much-ink" | "uneven-lines" | "no-lines" | null;
};

/**
 * `box` is the detection's box, already refined. `lines` is what the model
 * said about how many visual lines the block has; it is used to check the
 * rows found, never to invent one.
 */
export function textMask(
  image: RawImage,
  box: Box2d,
  options: {
    textColor?: string;
    lines?: number;
    settings?: TextMaskOptions;
  } = {},
): TextMask {
  const settings = options.settings ?? TEXT_MASK_DEFAULTS;
  const area = toPixels(box, image);
  const empty: TextMask = {
    mask: new Uint8Array(image.width * image.height),
    imageWidth: image.width,
    imageHeight: image.height,
    area,
    lines: [],
    linePitchPx: null,
    inkHeightPx: 0,
    coverage: 0,
    confident: false,
    reason: "no-lines",
  };
  if (area.x1 - area.x0 < 2 || area.y1 - area.y0 < 2) return empty;

  // The ring estimate first, then the inside-the-box one, exactly as the box
  // refinement does: a block on a card has no usable ring.
  let found = findInk(image, area, options.textColor, settings.refine, "ring");
  let ink = countInside(found, area);
  if (ink === 0) {
    found = findInk(image, area, options.textColor, settings.refine, "inside");
    ink = countInside(found, area);
  }

  // Only ink inside the detected box belongs to this block; the search area
  // reaches further out, and what it finds there is someone else's.
  const mask = new Uint8Array(image.width * image.height);
  for (let y = area.y0; y < area.y1; y += 1) {
    for (let x = area.x0; x < area.x1; x += 1) {
      const local = (y - found.search.y0) * found.width + (x - found.search.x0);
      if (found.mask[local]) mask[y * image.width + x] = 1;
    }
  }

  const boxWidth = area.x1 - area.x0;
  const boxHeight = area.y1 - area.y0;
  const coverage = ink / (boxWidth * boxHeight);

  // Rows of ink, then runs of rows: the visual lines.
  const rowMinimum = Math.max(1, Math.round(settings.rowShare * boxWidth));
  const active = new Array<boolean>(boxHeight).fill(false);
  for (let y = 0; y < boxHeight; y += 1) {
    let count = 0;
    for (let x = area.x0; x < area.x1; x += 1) count += mask[(area.y0 + y) * image.width + x];
    active[y] = count >= rowMinimum;
  }
  const runs = components(active, settings.rowGap).map(
    ([from, to]) => [area.y0 + from, area.y0 + to] as [number, number],
  );

  const result: TextMask = {
    mask,
    imageWidth: image.width,
    imageHeight: image.height,
    area,
    lines: runs,
    linePitchPx: null,
    inkHeightPx: 0,
    coverage,
    confident: false,
    reason: null,
  };
  if (runs.length === 0) return { ...result, reason: "no-lines" };

  // One line's ink height: the median run, so a stray dot cannot decide.
  const heights = runs.map(([from, to]) => to - from).sort((a, b) => a - b);
  result.inkHeightPx = heights[Math.floor(heights.length / 2)];

  if (runs.length > 1) {
    const gaps: number[] = [];
    for (let index = 1; index < runs.length; index += 1)
      gaps.push(runs[index][0] - runs[index - 1][0]);
    gaps.sort((a, b) => a - b);
    const pitch = gaps[Math.floor(gaps.length / 2)];
    result.linePitchPx = pitch;
    // Lines of one block sit at an even pitch. A block whose runs are uneven
    // is usually two things in one box, or an ornament cut into rows, and its
    // pitch is not a line height.
    const uneven = gaps.some((gap) => Math.abs(gap - pitch) > settings.pitchTolerance * pitch);
    if (uneven) return { ...result, reason: "uneven-lines" };
  }

  if (coverage < settings.minCoverage) return { ...result, reason: "low-ink" };
  if (coverage > settings.maxCoverage) return { ...result, reason: "too-much-ink" };

  // The model's line count is a check, not a source: rows that disagree with
  // it mean the two are not looking at the same thing.
  if (options.lines !== undefined && options.lines > 0) {
    const expected = options.lines;
    if (runs.length > expected * 2 || expected > runs.length * 2) {
      return { ...result, reason: "uneven-lines" };
    }
  }

  return { ...result, confident: true, reason: null };
}

function countInside(found: ReturnType<typeof findInk>, area: Rect): number {
  let count = 0;
  for (let y = area.y0; y < area.y1; y += 1) {
    for (let x = area.x0; x < area.x1; x += 1) {
      const local = (y - found.search.y0) * found.width + (x - found.search.x0);
      if (found.mask[local]) count += 1;
    }
  }
  return count;
}

/**
 * The smallest rectangle that holds every ink pixel, or null when there is
 * none. This is what a cover patch is sized from: the text, not the box.
 */
export function inkBounds(found: TextMask): Rect | null {
  const { area, imageWidth, mask } = found;
  let x0 = area.x1;
  let x1 = area.x0;
  let y0 = area.y1;
  let y1 = area.y0;
  for (let y = area.y0; y < area.y1; y += 1) {
    for (let x = area.x0; x < area.x1; x += 1) {
      if (!mask[y * imageWidth + x]) continue;
      if (x < x0) x0 = x;
      if (x + 1 > x1) x1 = x + 1;
      if (y < y0) y0 = y;
      if (y + 1 > y1) y1 = y + 1;
    }
  }
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}
