/**
 * Finds and removes the "Gemini Notebook" mark that NotebookLM exports put in
 * the bottom-right corner of every slide. Code only, no Gemini, and pure:
 * raw pixels in, raw pixels (a copy) out.
 *
 * Three rules keep other decks safe:
 * 1. A slide only counts when a thin line of letter-like edges sits exactly
 *    where the mark goes, at the mark's size (MARK below, measured on the
 *    sample deck with a margin).
 * 2. The deck is only cleaned when most of its slides carry that line in the
 *    same place (DECK_SHARE), so a corner with real, varying content never
 *    qualifies.
 * 3. Only slides whose line matches the deck-wide position are touched.
 */

import type { RawImage } from "./box-refine.ts";

export type Rect = { x0: number; y0: number; x1: number; y1: number }; // pixels, end exclusive

/** A rectangle as fractions of the image size, so decks of any resolution compare. */
export type RelativeRect = { x0: number; y0: number; x1: number; y1: number };

/**
 * Where the mark's line of letters sits, as fractions of the slide, and how
 * big it is. Measured on the sample deck (1376 x 768): letters at x 0.923 to
 * 0.993, y 0.975 to 0.986; on light slides a pill behind them reaches x 0.917
 * to 0.998, y 0.964 to 0.997. Tolerances leave room for other export sizes.
 */
export const MARK = {
  search: { x0: 0.9, y0: 0.95 },
  /** Columns the mark can occupy; edges elsewhere are ignored. */
  columns: { x0: 0.905, x1: 0.999 },
  /** Height of the mark's line of letters (8 px on a 768 px slide). */
  lineHeight: 0.0104,
  centerX: { min: 0.94, max: 0.975 },
  centerY: { min: 0.968, max: 0.99 },
  width: { min: 0.05, max: 0.095 },
  minEdges: 60,
};

/** Share of a deck's slides that must carry the mark in the same place. */
export const DECK_SHARE = 0.6;

function luminance(image: RawImage, x: number, y: number): number {
  const offset = (y * image.width + x) * image.channels;
  const red = image.data[offset];
  const green = image.data[offset + Math.min(1, image.channels - 1)];
  const blue = image.data[offset + Math.min(2, image.channels - 1)];
  return 0.299 * red + 0.587 * green + 0.114 * blue;
}

function runs(active: boolean[], gap: number): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  let start = -1;
  let last = -1;
  active.forEach((on, index) => {
    if (!on) return;
    if (start === -1) start = index;
    else if (index - last - 1 > gap) {
      found.push([start, last + 1]);
      start = index;
    }
    last = index;
  });
  if (start !== -1) found.push([start, last + 1]);
  return found;
}

/**
 * The mark's line of letters on one slide, or null. Letters make many sharp
 * horizontal brightness steps in a thin band, whatever the colors; ornaments
 * and gradients do not look like that at this size and place.
 */
export function findMark(image: RawImage): Rect | null {
  const x0 = Math.floor(MARK.search.x0 * image.width);
  const y0 = Math.floor(MARK.search.y0 * image.height);
  const width = image.width - x0;
  const height = image.height - y0;
  if (width < 20 || height < 8) return null;

  // Only the columns where the mark can be are counted, so an ornament that
  // runs across the corner above it cannot merge with its line.
  const columnFrom = Math.max(0, Math.floor(MARK.columns.x0 * image.width) - x0);
  const columnTo = Math.min(width - 1, Math.ceil(MARK.columns.x1 * image.width) - x0);
  const edges = new Uint8Array(width * height);
  const rowCounts = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = columnFrom; x < columnTo; x += 1) {
      const step = Math.abs(
        luminance(image, x0 + x + 1, y0 + y) - luminance(image, x0 + x, y0 + y),
      );
      if (step >= 32) {
        edges[y * width + x] = 1;
        rowCounts[y] += 1;
      }
    }
  }

  // The band: a window one letter-line high, slid over the rows where the
  // mark can be centred, keeping the one with the most letter edges. A dense
  // ornament just above the mark cannot stretch the band this way.
  const bandHeight = Math.max(3, Math.round(MARK.lineHeight * image.height));
  const firstTop = Math.max(0, Math.floor(MARK.centerY.min * image.height - bandHeight / 2) - y0);
  const lastTop = Math.min(
    height - bandHeight,
    Math.ceil(MARK.centerY.max * image.height - bandHeight / 2) - y0,
  );
  let best: { top: number; bottom: number; total: number } | null = null;
  for (let top = firstTop; top <= lastTop; top += 1) {
    let total = 0;
    for (let y = top; y < top + bandHeight; y += 1) total += rowCounts[y];
    if (!best || total > best.total) best = { top, bottom: top + bandHeight, total };
  }
  if (!best || best.total < MARK.minEdges) return null;

  // Its horizontal extent, bridging the gaps between words and the icon.
  const columns = new Array<boolean>(width).fill(false);
  for (let x = 0; x < width; x += 1) {
    for (let y = best.top; y < best.bottom; y += 1) {
      if (edges[y * width + x]) {
        columns[x] = true;
        break;
      }
    }
  }
  const spans = runs(columns, Math.max(4, Math.round(0.012 * image.width)));
  if (spans.length === 0) return null;
  const widest = spans.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));

  const rect: Rect = {
    x0: x0 + widest[0],
    y0: y0 + best.top,
    x1: x0 + widest[1] + 1,
    y1: y0 + best.bottom,
  };
  // The mark stands alone: no letters run on to its left, and no further
  // line sits below it. A line of real text crossing the corner fails here.
  const edgesIn = (fromX: number, toX: number, fromY: number, toY: number) => {
    let count = 0;
    for (let y = Math.max(0, fromY); y < Math.min(image.height, toY); y += 1) {
      for (let x = Math.max(0, fromX); x < Math.min(image.width - 1, toX); x += 1) {
        if (Math.abs(luminance(image, x + 1, y) - luminance(image, x, y)) >= 32) count += 1;
      }
    }
    return count;
  };
  const lineHeight = rect.y1 - rect.y0;
  const leftGap = Math.round(0.004 * image.width);
  const leftZone = edgesIn(
    rect.x0 - Math.round(0.03 * image.width),
    rect.x0 - leftGap,
    rect.y0,
    rect.y1,
  );
  const belowZone = edgesIn(
    rect.x0,
    rect.x1,
    rect.y1 + Math.ceil(lineHeight * 0.4),
    rect.y1 + lineHeight * 2,
  );
  if (leftZone > 0.1 * best.total || belowZone > 0.2 * best.total) return null;

  const centerX = (rect.x0 + rect.x1) / 2 / image.width;
  const centerY = (rect.y0 + rect.y1) / 2 / image.height;
  const markWidth = (rect.x1 - rect.x0) / image.width;
  const fits =
    centerX >= MARK.centerX.min &&
    centerX <= MARK.centerX.max &&
    centerY >= MARK.centerY.min &&
    centerY <= MARK.centerY.max &&
    markWidth >= MARK.width.min &&
    markWidth <= MARK.width.max;
  return fits ? rect : null;
}

export function toRelative(rect: Rect, image: { width: number; height: number }): RelativeRect {
  return {
    x0: rect.x0 / image.width,
    y0: rect.y0 / image.height,
    x1: rect.x1 / image.width,
    y1: rect.y1 / image.height,
  };
}

export type DeckDecision = {
  remove: boolean;
  /** Area to clean, relative to each slide, padded for the pill on light slides. */
  area: RelativeRect | null;
  /** Per slide: does it carry the mark at the deck-wide position? */
  slides: boolean[];
  /** Share of slides that carried it. */
  share: number;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Decides for the whole deck. `marks` holds each slide's findMark result,
 * relative to its own size. The mark must appear on at least DECK_SHARE of
 * the slides, and a slide only counts when its mark sits where the deck's
 * median mark sits (within 1% of the slide) at about the same size.
 */
export function decideForDeck(marks: ReadonlyArray<RelativeRect | null>): DeckDecision {
  const found = marks.filter((mark): mark is RelativeRect => mark !== null);
  const none: DeckDecision = {
    remove: false,
    area: null,
    slides: marks.map(() => false),
    share: 0,
  };
  if (marks.length === 0 || found.length === 0) return none;

  const center = {
    x: median(found.map((mark) => (mark.x0 + mark.x1) / 2)),
    y: median(found.map((mark) => (mark.y0 + mark.y1) / 2)),
    width: median(found.map((mark) => mark.x1 - mark.x0)),
    height: median(found.map((mark) => mark.y1 - mark.y0)),
  };
  const slides = marks.map((mark) => {
    if (!mark) return false;
    const sameX = Math.abs((mark.x0 + mark.x1) / 2 - center.x) <= 0.01;
    const sameY = Math.abs((mark.y0 + mark.y1) / 2 - center.y) <= 0.01;
    const sameWidth = Math.abs(mark.x1 - mark.x0 - center.width) <= 0.25 * center.width;
    return sameX && sameY && sameWidth;
  });
  const share = slides.filter(Boolean).length / marks.length;
  if (share < DECK_SHARE) return { ...none, share };

  // The pill behind the letters on light slides reaches about one letter
  // height beyond them on every side; the same padding is used everywhere.
  const padY = center.height * 1.1;
  const padX = center.height * 1.1;
  const area: RelativeRect = {
    x0: Math.max(0, center.x - center.width / 2 - padX),
    y0: Math.max(0, center.y - center.height / 2 - padY),
    x1: Math.min(1, center.x + center.width / 2 + padX),
    y1: Math.min(1, center.y + center.height / 2 + padY),
  };
  return { remove: true, area, slides, share };
}

export function toPixelRect(area: RelativeRect, image: { width: number; height: number }): Rect {
  return {
    x0: Math.max(0, Math.floor(area.x0 * image.width)),
    y0: Math.max(0, Math.floor(area.y0 * image.height)),
    x1: Math.min(image.width, Math.ceil(area.x1 * image.width)),
    y1: Math.min(image.height, Math.ceil(area.y1 * image.height)),
  };
}

/**
 * Which pixels belong to the mark on one slide: the letters (their box plus a
 * small margin) and, on light slides, the flat pill behind them. The pill is
 * only taken when it clearly differs from the background further out, and
 * only its own color is flooded, so a frame line or ornament that touches it
 * is left alone. Everything is kept inside `area`, the deck-wide clean area.
 *
 * The result is finally grown by MASK_DILATE pixels, because the mark does not
 * end where its letters do: anti-aliased edges, the text's drop shadow and the
 * pill's own shadow all reach a little further, and anything left of them reads
 * as a ghost of the words. Two values: 2 for the core, which is repainted
 * outright, and 1 for the grown rim, where the new texture is allowed to fade
 * into the slide. Every pixel of the mark itself is core, so no original pixel
 * of it can be blended back in.
 */
export const MASK_DILATE = 2;

export function markMask(
  image: RawImage,
  letters: Rect,
  area: Rect,
  dilate: number = MASK_DILATE,
): Uint8Array {
  return growMask(coreMask(image, letters, area), image, area, dilate);
}

/** How much detail a pixel carries over its 5x5 surroundings, in luma. */
function detailAt(image: RawImage, x: number, y: number): number {
  const { width: W, height: H, channels } = image;
  const luma = (px: number, py: number) => {
    const offset = (py * W + px) * channels;
    const read = (c: number) => image.data[offset + Math.min(c, channels - 1)];
    return 0.299 * read(0) + 0.587 * read(1) + 0.114 * read(2);
  };
  let sum = 0;
  let samples = 0;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      sum += luma(Math.min(Math.max(x + dx, 0), W - 1), Math.min(Math.max(y + dy, 0), H - 1));
      samples += 1;
    }
  }
  return luma(x, y) - sum / samples;
}

/** A pixel with this much detail is something of the slide's own, not a shadow. */
const ORNAMENT_DETAIL = 8;

/**
 * Which part of the tail describes a fill's grain. Speckles can be a few
 * percent of the pixels (scattered stars) or a third of them (a dense
 * texture), so the measure has to sit well out in the tail to see both.
 */
const GRAIN_QUANTILE = 0.98;

/**
 * Grows the core by `dilate` pixels (a square neighbourhood), staying inside
 * the deck-wide clean area so an ornament outside it can never be touched.
 * Core pixels keep the value 2, the grown rim gets 1.
 *
 * The rim only takes plain pixels. The gold frame runs a pixel or two above
 * the mark on this deck, and growing into it changed the bar by up to 98 of
 * 255 in luma: a detailed pixel is the slide's own, never the mark's shadow.
 */
function growMask(core: Uint8Array, image: RawImage, area: Rect, dilate: number): Uint8Array {
  const { width: W } = image;
  const out = new Uint8Array(core.length);
  for (let index = 0; index < core.length; index += 1) if (core[index]) out[index] = 2;
  if (dilate <= 0) return out;
  for (let y = area.y0; y < area.y1; y += 1) {
    for (let x = area.x0; x < area.x1; x += 1) {
      if (out[y * W + x]) continue;
      if (Math.abs(detailAt(image, x, y)) >= ORNAMENT_DETAIL) continue;
      let near = false;
      for (let dy = -dilate; dy <= dilate && !near; dy += 1) {
        for (let dx = -dilate; dx <= dilate; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < area.x0 || ny < area.y0 || nx >= area.x1 || ny >= area.y1) continue;
          if (core[ny * W + nx]) {
            near = true;
            break;
          }
        }
      }
      if (near) out[y * W + x] = 1;
    }
  }
  return out;
}

function coreMask(image: RawImage, letters: Rect, area: Rect): Uint8Array {
  const { width: W, height: H, channels } = image;
  const mask = new Uint8Array(W * H);
  const inside = (x: number, y: number) =>
    x >= area.x0 && x < area.x1 && y >= area.y0 && y < area.y1;
  const color = (x: number, y: number) => {
    const offset = (y * W + x) * channels;
    return [0, 1, 2].map((c) => image.data[offset + Math.min(c, channels - 1)]);
  };
  const distance = (a: number[], b: number[]) =>
    Math.max(...a.map((value, c) => Math.abs(value - b[c])));
  const medianColor = (points: Array<[number, number]>) =>
    [0, 1, 2].map((c) => median(points.map(([x, y]) => color(x, y)[c])));

  const margin = 2;
  const box: Rect = {
    x0: Math.max(area.x0, letters.x0 - margin),
    y0: Math.max(area.y0, letters.y0 - margin),
    x1: Math.min(area.x1, letters.x1 + margin),
    y1: Math.min(area.y1, letters.y1 + margin),
  };
  for (let y = box.y0; y < box.y1; y += 1)
    for (let x = box.x0; x < box.x1; x += 1) mask[y * W + x] = 1;

  // Color right around the letters (the pill, if there is one) against the
  // color well outside the clean area (the slide itself).
  const ring = (rect: Rect, gap: number) => {
    const points: Array<[number, number]> = [];
    for (let x = rect.x0 - gap; x < rect.x1 + gap; x += 1) {
      points.push([x, rect.y0 - gap], [x, rect.y1 - 1 + gap]);
    }
    for (let y = rect.y0 - gap; y < rect.y1 + gap; y += 1) {
      points.push([rect.x0 - gap, y], [rect.x1 - 1 + gap, y]);
    }
    return points.filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H);
  };
  const nearLetters = ring(box, 1).filter(([x, y]) => inside(x, y));
  const beyond = ring(area, 2);
  if (nearLetters.length === 0 || beyond.length === 0) return mask;
  const pill = medianColor(nearLetters);
  const slideColor = medianColor(beyond);
  if (distance(pill, slideColor) <= 14) return mask;

  // Flood the pill's own color outward from the letters, inside the area.
  const queue: Array<[number, number]> = [];
  for (const [x, y] of nearLetters) {
    if (distance(color(x, y), pill) <= 18 && !mask[y * W + x]) {
      mask[y * W + x] = 1;
      queue.push([x, y]);
    }
  }
  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (!inside(nx, ny) || mask[ny * W + nx]) continue;
      if (distance(color(nx, ny), pill) > 18) continue;
      mask[ny * W + nx] = 1;
      queue.push([nx, ny]);
    }
  }
  // One pixel more, for the soft rim of the pill's rounded edge.
  const grown = mask.slice();
  for (let y = area.y0; y < area.y1; y += 1) {
    for (let x = area.x0; x < area.x1; x += 1) {
      if (mask[y * W + x]) continue;
      if (
        (x > 0 && mask[y * W + x - 1]) ||
        (x < W - 1 && mask[y * W + x + 1]) ||
        (y > 0 && mask[(y - 1) * W + x]) ||
        (y < H - 1 && mask[(y + 1) * W + x])
      ) {
        grown[y * W + x] = 1;
      }
    }
  }
  return grown;
}

/**
 * Fills the masked pixels from their unmasked neighbours and returns a new
 * image; the input is never modified. The fill is harmonic (each masked pixel
 * settles at the average of its four neighbours), so colors flow in from all
 * around instead of being dragged in straight lines from a distant edge.
 * Pixels outside the mask, ornaments included, keep their exact values. Fine
 * grain from a neighbouring patch is added back so a textured background does
 * not turn into a smooth smear, unless that patch holds strong detail.
 */
export function fillMasked(image: RawImage, mask: Uint8Array): RawImage {
  const { width: W, height: H, channels } = image;
  const out = new Uint8Array(image.data.length);
  out.set(image.data);

  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!mask[y * W + x]) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  if (x1 < 0) return { ...image, data: out };

  const w = x1 - x0;
  const h = y1 - y0;
  const values = new Float32Array(w * h * 3);
  const known = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !mask[y * W + x];
  const read = (x: number, y: number, c: number) =>
    image.data[(y * W + x) * channels + Math.min(c, channels - 1)];

  // Start every unknown pixel at the mean of the known pixels around the box.
  const start = [0, 0, 0];
  let count = 0;
  for (let y = y0 - 1; y <= y1; y += 1) {
    for (let x = x0 - 1; x <= x1; x += 1) {
      if (!known(x, y)) continue;
      for (let c = 0; c < 3; c += 1) start[c] += read(x, y, c);
      count += 1;
    }
  }
  for (let c = 0; c < 3; c += 1) start[c] = count ? start[c] / count : 0;
  for (let index = 0; index < w * h; index += 1) {
    for (let c = 0; c < 3; c += 1) values[index * 3 + c] = start[c];
  }

  const valueAt = (x: number, y: number, c: number) => {
    if (x >= x0 && x < x1 && y >= y0 && y < y1 && mask[y * W + x])
      return values[((y - y0) * w + (x - x0)) * 3 + c];
    return read(x, y, c);
  };
  const iterations = Math.max(60, 2 * Math.max(w, h));
  for (let round = 0; round < iterations; round += 1) {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (!mask[y * W + x]) continue;
        for (let c = 0; c < 3; c += 1) {
          let sum = 0;
          let neighbours = 0;
          for (const [nx, ny] of [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ]) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            sum += valueAt(nx, ny, c);
            neighbours += 1;
          }
          values[((y - y0) * w + (x - x0)) * 3 + c] = sum / neighbours;
        }
      }
    }
  }

  // Grain donor: the same-size patch left of the box, or else above it.
  let donor: { x: number; y: number } | null = null;
  if (x0 - w >= 0) donor = { x: x0 - w, y: y0 };
  else if (y0 - h >= 0) donor = { x: x0, y: y0 - h };
  const grain = new Float32Array(w * h * 3);
  if (donor) {
    let energy = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        for (let c = 0; c < 3; c += 1) {
          let sum = 0;
          let samples = 0;
          for (let dy = -2; dy <= 2; dy += 1) {
            for (let dx = -2; dx <= 2; dx += 1) {
              const sx = Math.min(Math.max(donor.x + x + dx, 0), W - 1);
              const sy = Math.min(Math.max(donor.y + y + dy, 0), H - 1);
              sum += read(sx, sy, c);
              samples += 1;
            }
          }
          const value = read(donor.x + x, donor.y + y, c) - sum / samples;
          grain[(y * w + x) * 3 + c] = value;
          energy += value * value;
        }
      }
    }
    // Strong detail in the donor (an ornament, a letter) would be copied as a ghost.
    if (Math.sqrt(energy / (w * h * 3)) > 12) grain.fill(0);
  }

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (!mask[y * W + x]) continue;
      const index = (y - y0) * w + (x - x0);
      for (let c = 0; c < Math.min(3, channels); c += 1) {
        const value = values[index * 3 + c] + grain[index * 3 + c];
        out[(y * W + x) * channels + c] = Math.max(0, Math.min(255, Math.round(value)));
      }
    }
  }
  return { ...image, data: out };
}

/** How a slide's mark was filled, for the report and the tests. */
export type FillMethod = "mirror" | "patch" | "harmonic";

export type FillResult = { image: RawImage; method: FillMethod; score: number };

export const FILL_DEFAULTS = {
  /** Pixels of real background kept around the mask when candidates are judged. */
  margin: 10,
  /** Pixels over which a pasted patch fades in at the mask's rim. */
  feather: 2,
  /** Mean per-channel difference on that background a candidate may show. */
  accept: 6,
  /** Pixels of play allowed when the mirrored half is lined up. */
  align: 6,
  /** Step of the sideways search, in pixels. */
  step: 2,
  /**
   * How far a candidate's own grain may stand from the grain of the real
   * background around the mark, as a factor either way. The stars scattered
   * over this deck are a perfect detail match for each other, so matching
   * detail alone let the mirror paste stars into a corner that had none.
   */
  grainRatio: 2.5,
  /** Grain difference below this is too small to see, whatever the factor. */
  grainFloor: 1,
  /** Candidates whose grain is measured, per kind, best match first. */
  tries: 6,
  /** The coarse sweep steps this many search steps at a time. */
  coarse: 4,
  /** How many coarse winners are then searched around, step by step. */
  refine: 6,
};

type Source = { dx: number; dy: number; mirror: boolean };

/**
 * How much detail a pixel carries over its surroundings: what the blend keeps
 * from a patch. Judging candidates on this and not on plain colour lets a
 * patch from a lighter part of the same gradient win, which is right, because
 * the blend levels that difference out anyway.
 */
/**
 * `detailIn` for every pixel at once. The search below asks for it tens of
 * millions of times, so the 5x5 mean comes from a summed-area table, one
 * channel at a time: three additions per pixel instead of twenty-five reads.
 * Pixels within the window of the edge keep the plain path, which repeats the
 * edge pixel, so the result is identical to `detailIn` everywhere.
 */
function detailMapOf(image: RawImage): Float64Array {
  const { width: W, height: H, channels } = image;
  const map = new Float64Array(W * H * 3);
  const sums = new Float64Array((W + 1) * (H + 1));
  for (let c = 0; c < 3; c += 1) {
    const channel = Math.min(c, channels - 1);
    sums.fill(0);
    for (let y = 0; y < H; y += 1) {
      let row = 0;
      for (let x = 0; x < W; x += 1) {
        row += image.data[(y * W + x) * channels + channel];
        sums[(y + 1) * (W + 1) + x + 1] = sums[y * (W + 1) + x + 1] + row;
      }
    }
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const value = image.data[(y * W + x) * channels + channel];
        if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) {
          map[(y * W + x) * 3 + c] = detailIn(image, x, y, c);
          continue;
        }
        const x0 = x - 2;
        const y0 = y - 2;
        const x1 = x + 3;
        const y1 = y + 3;
        const total =
          sums[y1 * (W + 1) + x1] -
          sums[y0 * (W + 1) + x1] -
          sums[y1 * (W + 1) + x0] +
          sums[y0 * (W + 1) + x0];
        map[(y * W + x) * 3 + c] = value - total / 25;
      }
    }
  }
  return map;
}

function detailIn(image: RawImage, x: number, y: number, c: number): number {
  const { width: W, height: H, channels } = image;
  const read = (px: number, py: number) =>
    image.data[(py * W + px) * channels + Math.min(c, channels - 1)];
  let sum = 0;
  let samples = 0;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      sum += read(Math.min(Math.max(x + dx, 0), W - 1), Math.min(Math.max(y + dy, 0), H - 1));
      samples += 1;
    }
  }
  return read(x, y) - sum / samples;
}

/**
 * Copies texture from elsewhere on the same slide over the masked pixels.
 *
 * Decks like this one are symmetrical, so the first candidate is the slide
 * mirrored horizontally: the bottom-left corner in the bottom-right one's
 * place. Failing that, the most similar patch just around the mark is used.
 * A candidate is only accepted when it matches the real background still
 * visible around the mask; otherwise the harmonic fill takes over. What is
 * pasted is levelled to that background's brightness and fades in over a few
 * pixels, so no seam is left behind.
 */
export function fillFromTexture(
  image: RawImage,
  mask: Uint8Array,
  options = FILL_DEFAULTS,
): FillResult {
  const { width: W, height: H, channels } = image;
  const box = maskBox(mask, W, H);
  if (!box)
    return { image: { ...image, data: Uint8Array.from(image.data) }, method: "patch", score: 0 };

  const region = {
    x0: Math.max(0, box.x0 - options.margin),
    y0: Math.max(0, box.y0 - options.margin),
    x1: Math.min(W, box.x1 + options.margin),
    y1: Math.min(H, box.y1 + options.margin),
  };
  const read = (x: number, y: number, c: number) =>
    image.data[(y * W + x) * channels + Math.min(c, channels - 1)];
  const at = (source: Source, x: number, y: number) =>
    source.mirror
      ? { x: W - 1 - x + source.dx, y: y + source.dy }
      : { x: x + source.dx, y: y + source.dy };

  /**
   * How much detail a pixel carries over its surroundings: what the blend
   * below keeps from the patch. Judging candidates on this and not on plain
   * colour lets a patch from a lighter part of the same gradient win, which
   * is right, because the blend levels that difference out anyway.
   */
  const detailMap = detailMapOf(image);
  const detail = (x: number, y: number, c: number) => detailMap[(y * W + x) * 3 + c];

  /**
   * How lively a set of pixels is: how far the liveliest tenth of them stand
   * from their surroundings. Not the mean, because a gold frame line crossing
   * the ring would pass as "grain" and let any speckled patch through; not the
   * median either, because scattered stars are a tail, not the bulk, and the
   * median cannot see them.
   */
  const grainOf = (values: number[]) => {
    if (values.length === 0) return 0;
    values.sort((a, b) => a - b);
    return values[Math.min(values.length - 1, Math.floor(values.length * GRAIN_QUANTILE))];
  };

  /**
   * The grain of the real background the patch has to land in, tile by tile.
   * One grain for the whole ring would be decided by whichever tile the gold
   * frame crosses; the median over the tiles describes the plain background
   * the mark actually sits on.
   */
  const targetGrain = (() => {
    const tile = 8;
    const grains: number[] = [];
    for (let y = region.y0; y < region.y1; y += tile) {
      for (let x = region.x0; x < region.x1; x += tile) {
        const values: number[] = [];
        for (let ty = y; ty < Math.min(y + tile, region.y1); ty += 1) {
          for (let tx = x; tx < Math.min(x + tile, region.x1); tx += 1) {
            if (mask[ty * W + tx]) continue;
            for (let c = 0; c < 3; c += 1) values.push(Math.abs(detail(tx, ty, c)));
          }
        }
        if (values.length >= tile * 3) grains.push(grainOf(values));
      }
    }
    return grains.length === 0 ? 0 : median(grains);
  })();

  /**
   * How well a candidate matches the detail of the real background still
   * visible around the mask. A source that would copy part of the mark itself
   * is refused outright.
   */
  const judge = (source: Source): { score: number } | null => {
    const residuals: number[] = [];
    for (let y = region.y0; y < region.y1; y += 1) {
      for (let x = region.x0; x < region.x1; x += 1) {
        const from = at(source, x, y);
        if (from.x < 0 || from.y < 0 || from.x >= W || from.y >= H) return null;
        if (mask[from.y * W + from.x]) return null;
        if (mask[y * W + x]) continue;
        for (let c = 0; c < 3; c += 1)
          residuals.push(Math.abs(detail(from.x, from.y, c) - detail(x, y, c)));
      }
    }
    if (residuals.length < 300) return null;
    // The median, not the mean: a gold frame line crossing the region can
    // never be matched by a patch from elsewhere, and it is not going to be
    // painted over either, so those few pixels must not decide.
    residuals.sort((a, b) => a - b);
    return { score: residuals[Math.floor(residuals.length / 2)] };
  };

  /** Candidates that can be pasted at all, best detail match first. */
  const rank = (sources: Source[]) =>
    sources
      .map((source) => ({ source, judged: judge(source) }))
      .filter(
        (entry): entry is { source: Source; judged: { score: number } } => entry.judged !== null,
      )
      .sort((a, b) => a.judged.score - b.judged.score);

  // The mirror, allowed a few pixels of play: a deck is symmetrical by design
  // but rarely to the pixel, and the ornament under the mark is only ever
  // recoverable from its twin on the other side.
  const mirrors: Source[] = [];
  for (let dy = -options.align; dy <= options.align; dy += 1) {
    for (let dx = -options.align; dx <= options.align; dx += 1) {
      mirrors.push({ dx, dy, mirror: true });
    }
  }
  // The neighbourhood of the mark, a few mark-widths left and above it. The
  // grid is swept coarsely first and then refined around the best few, which
  // is what keeps a slide's removal near a second instead of half a minute.
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const inNeighbourhood = (dx: number, dy: number) =>
    !(Math.abs(dx) < w / 2 && Math.abs(dy) < h / 2);
  const coarse: Source[] = [];
  for (let dy = -4 * h; dy <= 2 * h; dy += options.step * options.coarse) {
    for (let dx = -6 * w; dx <= 2 * w; dx += options.step * options.coarse) {
      if (inNeighbourhood(dx, dy)) coarse.push({ dx, dy, mirror: false });
    }
  }
  const patches: Source[] = [];
  const seen = new Set<string>();
  const addPatch = (dx: number, dy: number) => {
    const key = `${dx},${dy}`;
    if (seen.has(key) || !inNeighbourhood(dx, dy)) return;
    seen.add(key);
    patches.push({ dx, dy, mirror: false });
  };
  for (const { source } of rank(coarse).slice(0, options.refine)) {
    const reach = options.step * options.coarse;
    for (let dy = source.dy - reach; dy <= source.dy + reach; dy += options.step) {
      for (let dx = source.dx - reach; dx <= source.dx + reach; dx += options.step) {
        addPatch(dx, dy);
      }
    }
  }

  const alpha = feather(mask, W, H, options.feather);

  /** What the slide looks like with this candidate pasted in. */
  const paste = (source: Source): RawImage => {
    const from = (x: number, y: number, c: number): number | null => {
      const point = at(source, x, y);
      if (point.x < 0 || point.y < 0 || point.x >= W || point.y >= H) return null;
      return read(point.x, point.y, c);
    };
    const out = Uint8Array.from(image.data);
    const membrane = solveMembrane(image, mask, from, box, options.feather);
    for (let y = box.y0; y < box.y1; y += 1) {
      for (let x = box.x0; x < box.x1; x += 1) {
        const weight = alpha[y * W + x];
        if (!weight) continue;
        for (let c = 0; c < Math.min(3, channels); c += 1) {
          const pasted = from(x, y, c);
          if (pasted === null) continue;
          const index = ((y - box.y0) * (box.x1 - box.x0) + (x - box.x0)) * 3 + c;
          const mixed = read(x, y, c) * (1 - weight) + (pasted + membrane[index]) * weight;
          out[(y * W + x) * channels + c] = Math.max(0, Math.min(255, Math.round(mixed)));
        }
      }
    }
    return { ...image, data: out };
  };

  /**
   * The grain a candidate would lay over the mark: measured on the pixels it
   * would really cover, at the place it reads them from. The membrane added
   * later is a smooth field, so it moves this hardly at all, and skipping it
   * here keeps the search cheap.
   */
  const candidateGrain = (source: Source) => {
    const values: number[] = [];
    for (let y = box.y0; y < box.y1; y += 1) {
      for (let x = box.x0; x < box.x1; x += 1) {
        if (!mask[y * W + x]) continue;
        const point = at(source, x, y);
        if (point.x < 0 || point.y < 0 || point.x >= W || point.y >= H) continue;
        for (let c = 0; c < 3; c += 1) values.push(Math.abs(detail(point.x, point.y, c)));
      }
    }
    return grainOf(values);
  };

  /** The same measure on a finished image, for the smooth fill. */
  const filledGrain = (filled: RawImage) => {
    const values: number[] = [];
    for (let y = box.y0; y < box.y1; y += 1) {
      for (let x = box.x0; x < box.x1; x += 1) {
        if (!mask[y * W + x]) continue;
        for (let c = 0; c < 3; c += 1) values.push(Math.abs(detailIn(filled, x, y, c)));
      }
    }
    return grainOf(values);
  };

  const tooDifferent = (grain: number) =>
    grain > targetGrain * options.grainRatio + options.grainFloor ||
    targetGrain > grain * options.grainRatio + options.grainFloor;

  /** The closest match seen, accepted or not, so a refusal can be reported. */
  let nearest: number | null = null;
  /** The best-matching candidate refused for its grain, as a last resort. */
  let refused: { source: Source; score: number; method: FillMethod } | null = null;

  for (const [method, sources] of [
    ["mirror", mirrors],
    ["patch", patches],
  ] as Array<[FillMethod, Source[]]>) {
    const ranked = rank(sources);
    if (ranked.length > 0 && (nearest === null || ranked[0].judged.score < nearest)) {
      nearest = ranked[0].judged.score;
    }
    for (const { source, judged } of ranked.slice(0, options.tries)) {
      if (judged.score > options.accept) break;
      if (!tooDifferent(candidateGrain(source))) {
        return { image: paste(source), method, score: judged.score };
      }
      if (!refused) refused = { source, score: judged.score, method };
    }
  }

  // Nothing comparable was found. The smooth fill invents no texture at all,
  // which is better than pasting a texture the corner never had; it is only
  // passed over when it would itself be far flatter than the background.
  const harmonic = fillMasked(image, mask);
  if (refused === null || !tooDifferent(filledGrain(harmonic))) {
    return { image: harmonic, method: "harmonic", score: nearest ?? Infinity };
  }
  return { image: paste(refused.source), method: refused.method, score: refused.score };
}

/**
 * The correction that makes a pasted patch meet the slide without a seam.
 *
 * On the pixels just outside the mask the patch is wrong by a known amount;
 * that difference is spread smoothly across the masked area (a harmonic
 * membrane, the same relaxation the harmonic fill uses) and added to the
 * patch. Lighting and colour then match at the rim while the patch's own
 * detail, an ornament for instance, is kept.
 */
function solveMembrane(
  image: RawImage,
  mask: Uint8Array,
  patch: (x: number, y: number, c: number) => number | null,
  box: Rect,
  rounds: number,
): Float32Array {
  const { width: W, height: H, channels } = image;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const field = new Float32Array(w * h * 3);
  const read = (x: number, y: number, c: number) =>
    image.data[(y * W + x) * channels + Math.min(c, channels - 1)];
  const difference = (x: number, y: number, c: number) => {
    const pasted = patch(x, y, c);
    return pasted === null ? 0 : read(x, y, c) - pasted;
  };
  const valueAt = (x: number, y: number, c: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    if (mask[y * W + x]) {
      if (x < box.x0 || y < box.y0 || x >= box.x1 || y >= box.y1) return 0;
      return field[((y - box.y0) * w + (x - box.x0)) * 3 + c];
    }
    return difference(x, y, c); // the rim: the correction the slide asks for
  };
  const iterations = Math.max(60, 2 * Math.max(w, h), rounds);
  for (let round = 0; round < iterations; round += 1) {
    for (let y = box.y0; y < box.y1; y += 1) {
      for (let x = box.x0; x < box.x1; x += 1) {
        if (!mask[y * W + x]) continue;
        for (let c = 0; c < 3; c += 1) {
          const sum =
            valueAt(x - 1, y, c) +
            valueAt(x + 1, y, c) +
            valueAt(x, y - 1, c) +
            valueAt(x, y + 1, c);
          field[((y - box.y0) * w + (x - box.x0)) * 3 + c] = sum / 4;
        }
      }
    }
  }
  return field;
}

function maskBox(mask: Uint8Array, W: number, H: number): Rect | null {
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!mask[y * W + x]) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * 1 deep inside the mask, fading to 0 at its rim, over `width` pixels. The
 * fade runs inwards: pixels outside the mask, an ornament touching it for
 * instance, keep their exact values, and the pasted patch still has no hard
 * edge.
 *
 * Core pixels (value 2, the mark itself) are always a full 1: blending there
 * would mix the mark back into its own replacement, which is exactly what left
 * a readable ghost behind. The fade therefore lives entirely in the grown rim,
 * which sits on background.
 */
function feather(mask: Uint8Array, W: number, H: number, width: number): Float32Array {
  const alpha = new Float32Array(W * H);
  const depth = new Int32Array(W * H); // rings from the rim, 0 outside the mask
  let front: number[] = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const index = y * W + x;
      if (!mask[index]) continue;
      const rim =
        x === 0 ||
        y === 0 ||
        x === W - 1 ||
        y === H - 1 ||
        !mask[index - 1] ||
        !mask[index + 1] ||
        !mask[index - W] ||
        !mask[index + W];
      if (rim) {
        depth[index] = 1;
        front.push(index);
      }
    }
  }
  for (let ring = 2; front.length > 0; ring += 1) {
    const next: number[] = [];
    for (const index of front) {
      const x = index % W;
      const y = (index - x) / W;
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const at = ny * W + nx;
        if (!mask[at] || depth[at]) continue;
        depth[at] = ring;
        next.push(at);
      }
    }
    front = next;
  }
  for (let index = 0; index < alpha.length; index += 1) {
    if (!mask[index]) continue;
    alpha[index] = mask[index] === 2 ? 1 : Math.min(1, depth[index] / Math.max(1, width));
  }
  return alpha;
}

/**
 * Removes the mark from one slide: its mask, then texture from elsewhere on
 * the same slide, with the harmonic fill as the last resort. Returns a copy.
 */
export function removeMark(image: RawImage, letters: Rect, area: Rect): FillResult {
  return fillFromTexture(image, markMask(image, letters, area));
}

/**
 * With watermark removal on, a block Gemini labelled "watermark" is not
 * exported as a text box: the mark is gone from the background as well.
 */
export function exportableBlocks<T extends { role: string }>(
  blocks: readonly T[],
  options: { removeWatermark: boolean },
): T[] {
  return options.removeWatermark
    ? blocks.filter((block) => block.role !== "watermark")
    : [...blocks];
}
