/**
 * Tightens a Gemini text box to the ink actually on the slide.
 *
 * Measured on the sample deck (docs/HANDOFF.md): Gemini's boxes sit about
 * 1.3% of the slide height too high, more so lower on the slide, and are
 * about 15% too wide on both sides; their centres are not off horizontally.
 * So the search looks further up and down than sideways, and the result may
 * shrink a box but hardly grow it.
 *
 * Decorated slides are full of things that are not the background either:
 * ornaments, runes, sparkles, table rules. Where Gemini reported the text
 * color, only pixels near that color count as ink, and a result that grows
 * or moves too much is refused rather than trusted.
 *
 * This only moves box edges, from raw pixels, and never looks at or changes
 * the text. Pure: raw pixels in, a box out; the caller decodes the image.
 */

export type RawImage = {
  data: Uint8Array | Uint8ClampedArray | Buffer;
  width: number;
  height: number;
  channels: number;
};

/** [ymin, xmin, ymax, xmax] in 0-1000 of the whole image. */
export type Box2d = readonly [number, number, number, number];

export type RefineReason =
  "empty-box" | "low-contrast" | "too-small" | "too-large" | "moved-too-far";

export type RefineResult =
  { refined: true; box: Box2d } | { refined: false; box: Box2d; reason: RefineReason };

export type RefineOptions = {
  /** How far the search reaches sideways, as a share of the slide width. */
  marginX: number;
  /** How far the search reaches up and down, as a share of the slide height. */
  marginY: number;
  /** Floor for the difference from the background that counts as ink (0-255, per channel). */
  minContrast: number;
  /** Added on top of the background's own variation (twice its 75th percentile). */
  noiseHeadroom: number;
  /** How close to the reported text color a pixel must be to count (0-255, per channel). */
  colorTolerance: number;
  /** Padding around the ink in the result, in pixels. */
  padding: number;
  /** The result may be at most this much wider / taller than Gemini's box. */
  maxGrowthX: number;
  maxGrowthY: number;
  /** The result's centre may move at most this share of Gemini's box size. */
  maxShiftX: number;
  maxShiftY: number;
};

export const REFINE_DEFAULTS: RefineOptions = {
  marginX: 0.01,
  marginY: 0.025,
  minContrast: 48,
  noiseHeadroom: 24,
  colorTolerance: 90,
  padding: 2,
  maxGrowthX: 1.05,
  maxGrowthY: 1.6,
  maxShiftX: 0.25,
  maxShiftY: 0.6,
};

type Rect = { x0: number; y0: number; x1: number; y1: number }; // x1, y1 exclusive

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function toPixels(box: Box2d, image: RawImage): Rect {
  return {
    x0: clamp(Math.floor((box[1] / 1000) * image.width), 0, image.width),
    y0: clamp(Math.floor((box[0] / 1000) * image.height), 0, image.height),
    x1: clamp(Math.ceil((box[3] / 1000) * image.width), 0, image.width),
    y1: clamp(Math.ceil((box[2] / 1000) * image.height), 0, image.height),
  };
}

function toBox(rect: Rect, image: RawImage): Box2d {
  return [
    (rect.y0 / image.height) * 1000,
    (rect.x0 / image.width) * 1000,
    (rect.y1 / image.height) * 1000,
    (rect.x1 / image.width) * 1000,
  ];
}

export function parseHexColor(value: string | undefined): number[] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value ?? "");
  if (!match) return null;
  const hex = match[1];
  return [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16));
}

/** Median of each color channel over the one-pixel ring around the search area. */
function ringMedian(image: RawImage, rect: Rect): { color: number[]; ring: number[] } {
  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const ring: number[] = [];
  const visit = (x: number, y: number) => {
    const offset = (y * image.width + x) * image.channels;
    ring.push(offset);
    for (let channel = 0; channel < 3; channel += 1) {
      histograms[channel][image.data[offset + Math.min(channel, image.channels - 1)]] += 1;
    }
  };
  for (let x = rect.x0; x < rect.x1; x += 1) {
    visit(x, rect.y0);
    if (rect.y1 - 1 > rect.y0) visit(x, rect.y1 - 1);
  }
  for (let y = rect.y0 + 1; y < rect.y1 - 1; y += 1) {
    visit(rect.x0, y);
    if (rect.x1 - 1 > rect.x0) visit(rect.x1 - 1, y);
  }
  const half = ring.length / 2;
  const color = histograms.map((histogram) => {
    let seen = 0;
    for (let value = 0; value < 256; value += 1) {
      seen += histogram[value];
      if (seen >= half) return value;
    }
    return 255;
  });
  return { color, ring };
}

function difference(image: RawImage, offset: number, reference: number[]): number {
  let largest = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    const value = image.data[offset + Math.min(channel, image.channels - 1)];
    largest = Math.max(largest, Math.abs(value - reference[channel]));
  }
  return largest;
}

/** Runs of active indexes, merging runs whose gap is at most `gap`. */
function components(active: boolean[], gap: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  let lastActive = -1;
  for (let index = 0; index < active.length; index += 1) {
    if (!active[index]) continue;
    if (start === -1) start = index;
    else if (index - lastActive - 1 > gap) {
      runs.push([start, lastActive + 1]);
      start = index;
    }
    lastActive = index;
  }
  if (start !== -1) runs.push([start, lastActive + 1]);
  return runs;
}

/** Keeps runs that lie mostly inside [low, high): at least 40% of each run. */
function keepOverlapping(runs: Array<[number, number]>, low: number, high: number) {
  return runs.filter(([from, to]) => {
    const overlap = Math.max(0, Math.min(to, high) - Math.max(from, low));
    return overlap >= 0.4 * (to - from);
  });
}

export function refineBox(
  image: RawImage,
  box: Box2d,
  textColor?: string,
  options: RefineOptions = REFINE_DEFAULTS,
): RefineResult {
  const original = toPixels(box, image);
  const originalWidth = original.x1 - original.x0;
  const originalHeight = original.y1 - original.y0;
  if (originalWidth < 2 || originalHeight < 2) return { refined: false, box, reason: "empty-box" };

  const search: Rect = {
    x0: clamp(original.x0 - Math.round(options.marginX * image.width), 0, image.width),
    y0: clamp(original.y0 - Math.round(options.marginY * image.height), 0, image.height),
    x1: clamp(original.x1 + Math.round(options.marginX * image.width), 0, image.width),
    y1: clamp(original.y1 + Math.round(options.marginY * image.height), 0, image.height),
  };
  const width = search.x1 - search.x0;
  const height = search.y1 - search.y0;

  // Ink differs from the background by more than the background differs from
  // itself. Twice the 75th percentile of the ring, not the 95th: text from a
  // neighbouring block often touches the ring and must not raise the bar.
  const { color: background, ring } = ringMedian(image, search);
  const ringDifferences = ring
    .map((offset) => difference(image, offset, background))
    .sort((a, b) => a - b);
  const noise = 2 * (ringDifferences[Math.floor(ringDifferences.length * 0.75)] ?? 0);
  const threshold = Math.max(options.minContrast, noise + options.noiseHeadroom);

  const contrast = new Uint8Array(width * height);
  const colored = new Uint8Array(width * height);
  const text = parseHexColor(textColor);
  let contrastCount = 0;
  let coloredCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((search.y0 + y) * image.width + search.x0 + x) * image.channels;
      if (difference(image, offset, background) < threshold) continue;
      contrast[y * width + x] = 1;
      contrastCount += 1;
      if (text && difference(image, offset, text) <= options.colorTolerance) {
        colored[y * width + x] = 1;
        coloredCount += 1;
      }
    }
  }
  // Prefer pixels in the text's own color. If Gemini's color is clearly off
  // (hardly any pixel matches it), fall back to contrast alone.
  const mask = text && coloredCount >= 0.25 * contrastCount ? colored : contrast;

  // Long straight lines are frames and rules, not letters.
  const columnCounts = new Array<number>(width).fill(0);
  const rowCounts = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      columnCounts[x] += 1;
      rowCounts[y] += 1;
    }
  }
  for (let x = 0; x < width; x += 1) {
    if (columnCounts[x] > 0.85 * height) {
      for (let y = 0; y < height; y += 1) mask[y * width + x] = 0;
    }
  }
  for (let y = 0; y < height; y += 1) {
    if (rowCounts[y] > 0.85 * width) for (let x = 0; x < width; x += 1) mask[y * width + x] = 0;
  }

  // Rows first: text lines, keeping the ones Gemini's box mostly covers.
  const rowActive = new Array<boolean>(height).fill(false);
  const rowMinimum = Math.max(2, Math.round(0.004 * width));
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 1) count += mask[y * width + x];
    rowActive[y] = count >= rowMinimum;
  }
  const rowGap = Math.max(2, Math.round(0.004 * image.height));
  const rows = keepOverlapping(
    components(rowActive, rowGap),
    original.y0 - search.y0,
    original.y1 - search.y0,
  );
  if (rows.length === 0) return { refined: false, box, reason: "low-contrast" };
  const top = rows[0][0];
  const bottom = rows[rows.length - 1][1];

  // Then columns, only across the chosen lines; word gaps are bridged.
  const columnActive = new Array<boolean>(width).fill(false);
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = top; y < bottom; y += 1) count += mask[y * width + x];
    columnActive[x] = count >= 2;
  }
  const columnGap = Math.max(3, Math.round(0.02 * image.width));
  const columns = keepOverlapping(
    components(columnActive, columnGap),
    original.x0 - search.x0,
    original.x1 - search.x0,
  );
  if (columns.length === 0) return { refined: false, box, reason: "low-contrast" };

  const ink: Rect = {
    x0: clamp(search.x0 + columns[0][0] - options.padding, 0, image.width),
    y0: clamp(search.y0 + top - options.padding, 0, image.height),
    x1: clamp(search.x0 + columns[columns.length - 1][1] + options.padding, 0, image.width),
    y1: clamp(search.y0 + bottom + options.padding, 0, image.height),
  };
  const inkWidth = ink.x1 - ink.x0;
  const inkHeight = ink.y1 - ink.y0;

  if (inkWidth < 4 || inkHeight < 4) return { refined: false, box, reason: "too-small" };
  if ((inkWidth * inkHeight) / (originalWidth * originalHeight) < 0.2) {
    return { refined: false, box, reason: "too-small" };
  }
  if (
    inkWidth > options.maxGrowthX * originalWidth ||
    inkHeight > options.maxGrowthY * originalHeight
  ) {
    return { refined: false, box, reason: "too-large" };
  }
  const shiftX = Math.abs((ink.x0 + ink.x1) / 2 - (original.x0 + original.x1) / 2);
  const shiftY = Math.abs((ink.y0 + ink.y1) / 2 - (original.y0 + original.y1) / 2);
  if (shiftX > options.maxShiftX * originalWidth || shiftY > options.maxShiftY * originalHeight) {
    return { refined: false, box, reason: "moved-too-far" };
  }
  return { refined: true, box: toBox(ink, image) };
}
