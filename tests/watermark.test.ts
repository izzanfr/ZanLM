import test from "node:test";
import assert from "node:assert/strict";
import type { RawImage } from "../lib/box-refine.ts";
import {
  decideForDeck,
  exportableBlocks,
  fillFromTexture,
  fillMasked,
  FILL_DEFAULTS,
  findMark,
  markMask,
  MASK_DILATE,
  removeMark,
  toPixelRect,
  toRelative,
  type RelativeRect,
} from "../lib/watermark.ts";

// Synthetic slides only. The "mark" is a thin line of letter-like strokes at
// the NotebookLM position; nothing from the sample deck is used.

const W = 1376;
const H = 768;

function slide(background: [number, number, number], noise = 0, seed = 3): RawImage {
  const data = new Uint8Array(W * H * 3);
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  for (let index = 0; index < W * H; index += 1) {
    const jitter = noise ? Math.round((random() - 0.5) * 2 * noise) : 0;
    for (let channel = 0; channel < 3; channel += 1) {
      data[index * 3 + channel] = Math.max(0, Math.min(255, background[channel] + jitter));
    }
  }
  return { data, width: W, height: H, channels: 3 };
}

function fill(image: RawImage, x0: number, y0: number, x1: number, y1: number, color: number[]) {
  for (let y = Math.max(0, y0); y < Math.min(image.height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(image.width, x1); x += 1) {
      const offset = (y * image.width + x) * image.channels;
      for (let channel = 0; channel < 3; channel += 1)
        image.data[offset + channel] = color[channel];
    }
  }
}

/** Letter-like strokes: 2 px wide, 4 px apart, in a line `height` px tall. */
function letters(
  image: RawImage,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number[],
) {
  for (let cursor = x; cursor < x + width - 2; cursor += 4) {
    fill(image, cursor, y, cursor + 2, y + height, color);
  }
}

/** A mark like NotebookLM's: 98 x 8 px at x 0.922, y 0.975, optionally on a pill. */
function mark(image: RawImage, color: number[], pill?: number[]) {
  if (pill) fill(image, 1262, 740, 1374, 766, pill);
  letters(image, 1269, 749, 98, 8, color);
}

test("the mark is found on a dark slide", () => {
  const image = slide([13, 24, 38]);
  mark(image, [230, 230, 230]);
  const found = findMark(image);
  assert.ok(found, "mark expected");
  assert.ok(Math.abs(found.x0 - 1269) <= 3 && Math.abs(found.y0 - 749) <= 3);
});

test("the mark is found on a light slide with its pill", () => {
  const image = slide([175, 170, 167]);
  mark(image, [40, 40, 40], [220, 215, 205]);
  assert.ok(findMark(image), "mark expected");
});

test("a textured background with no mark has none", () => {
  assert.equal(findMark(slide([13, 24, 38], 10)), null);
  assert.equal(findMark(slide([175, 170, 167])), null);
});

test("real content in the corner is not taken for the mark", () => {
  // A large block of text filling the corner.
  const big = slide([13, 24, 38]);
  for (let row = 0; row < 3; row += 1) letters(big, 1180, 700 + row * 22, 190, 16, [230, 230, 230]);
  assert.equal(findMark(big), null);
  // A short page number, far narrower than the mark.
  const pageNumber = slide([13, 24, 38]);
  letters(pageNumber, 1340, 749, 20, 8, [230, 230, 230]);
  assert.equal(findMark(pageNumber), null);
});

const at = (x0: number, y0: number, x1: number, y1: number): RelativeRect => ({ x0, y0, x1, y1 });
const notebookMark = at(0.922, 0.975, 0.993, 0.986);

test("the deck is cleaned when most slides carry the mark in one place", () => {
  const decision = decideForDeck([notebookMark, notebookMark, null, notebookMark, notebookMark]);
  assert.equal(decision.remove, true);
  assert.equal(decision.share, 0.8);
  assert.deepEqual(decision.slides, [true, true, false, true, true]);
  // The area covers the letters with room for the pill.
  assert.ok(decision.area && decision.area.x0 < 0.922 && decision.area.y0 < 0.975);
  assert.ok(decision.area && decision.area.x1 <= 1 && decision.area.y1 <= 1);
});

test("a deck where only a few slides show it is left alone", () => {
  const decision = decideForDeck([notebookMark, null, null, notebookMark, null]);
  assert.equal(decision.remove, false);
  assert.deepEqual(decision.slides, [false, false, false, false, false]);
});

test("a stray match in another place does not count", () => {
  const stray = at(0.914, 0.981, 0.967, 0.992);
  const decision = decideForDeck([notebookMark, notebookMark, stray, notebookMark, notebookMark]);
  assert.equal(decision.remove, true);
  assert.equal(decision.slides[2], false, "the stray slide is not touched");
});

test("corner content that varies from slide to slide never qualifies", () => {
  const decision = decideForDeck([
    at(0.922, 0.975, 0.993, 0.986),
    at(0.9, 0.955, 0.96, 0.97),
    at(0.94, 0.96, 0.99, 0.999),
    at(0.905, 0.985, 0.95, 0.996),
    null,
  ]);
  assert.equal(decision.remove, false);
});

function regionStats(image: RawImage, x0: number, y0: number, x1: number, y1: number) {
  const values: number[] = [];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1)
      values.push(image.data[(y * image.width + x) * image.channels]);
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { mean, deviation, max: Math.max(...values), min: Math.min(...values) };
}

test("filling removes the mark and leaves the original untouched", () => {
  const image = slide([13, 24, 38]);
  mark(image, [230, 230, 230]);
  const before = Buffer.from(image.data);
  const found = findMark(image);
  assert.ok(found);
  const decision = decideForDeck([toRelative(found, image), toRelative(found, image)]);
  assert.ok(decision.area);
  const cleaned = removeMark(image, found, toPixelRect(decision.area, image)).image;
  // The input is not modified.
  assert.equal(Buffer.compare(Buffer.from(image.data), before), 0);
  // Nothing bright is left where the mark was.
  const stats = regionStats(cleaned, 1262, 740, 1374, 766);
  assert.ok(stats.max < 40, `brightest pixel left ${stats.max}`);
  assert.equal(findMark(cleaned), null);
});

test("the light pill goes too, not only the letters", () => {
  const image = slide([175, 170, 167]);
  mark(image, [40, 40, 40], [220, 215, 205]);
  const found = findMark(image);
  assert.ok(found);
  const decision = decideForDeck([toRelative(found, image), toRelative(found, image)]);
  const cleaned = removeMark(image, found, toPixelRect(decision.area!, image)).image;
  const stats = regionStats(cleaned, 1262, 740, 1374, 766);
  assert.ok(
    Math.abs(stats.mean - 172) < 12,
    `mean ${stats.mean.toFixed(1)} should match the background`,
  );
  assert.ok(stats.max - stats.min < 30, "no pill edge or letter left");
});

test("a textured background keeps its grain instead of a flat patch", () => {
  const image = slide([120, 100, 80], 8);
  mark(image, [250, 250, 250]);
  const found = findMark(image);
  assert.ok(found);
  const decision = decideForDeck([toRelative(found, image), toRelative(found, image)]);
  const rect = toPixelRect(decision.area!, image);
  const cleaned = removeMark(image, found, rect).image;
  const inside = regionStats(cleaned, found.x0, found.y0, found.x1, found.y1);
  const outside = regionStats(image, rect.x0 - 120, rect.y0, rect.x0 - 20, rect.y1);
  assert.ok(Math.abs(inside.mean - outside.mean) < 8, "same brightness as around it");
  assert.ok(inside.deviation > 0.4 * outside.deviation, "some grain survives");
  assert.ok(inside.max < 200, "no letter left");
});

test("a speckled mirror is refused over a corner that has no speckles", () => {
  // A plain corner on the right; the left half, which the mirror copies from,
  // is covered in bright specks. Their detail matches any other speck, so the
  // mirror used to win on detail alone and paste a starfield into the corner.
  const image = slide([18, 26, 44], 2);
  let state = 11;
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  for (let index = 0; index < 4000; index += 1) {
    const x = Math.floor(random() * (W / 2));
    const y = 700 + Math.floor(random() * 68);
    fill(image, x, y, x + 1, y + 1, [230, 235, 255]);
  }
  mark(image, [230, 230, 230]);
  const found = findMark(image);
  assert.ok(found);
  const rect = toPixelRect(decideForDeck([toRelative(found, image)]).area!, image);
  const result = removeMark(image, found, rect);

  assert.notEqual(result.method, "mirror", "the speckled half must not be copied over");
  // Nothing as bright as a speck is left in the corner the mark occupied.
  const stats = regionStats(result.image, found.x0, found.y0, found.x1, found.y1);
  assert.ok(stats.max < 120, `brightest pixel left ${stats.max}`);
  assert.equal(findMark(result.image), null, "the mark itself is gone");
});

test("the mirrored other corner brings back an ornament the mark covered", () => {
  // A deck laid out symmetrically: the same bar low on the left and the right.
  const clean = slide([178, 172, 165], 3);
  for (const [x0, x1] of [
    [40, 260],
    [W - 260, W - 40],
  ]) {
    fill(clean, x0, 744, x1, 752, [196, 164, 74]);
  }
  const image: RawImage = { ...clean, data: Uint8Array.from(clean.data) };
  mark(image, [40, 40, 40], [220, 215, 205]);
  const found = findMark(image);
  assert.ok(found);
  const decision = decideForDeck([toRelative(found, image), toRelative(found, image)]);
  const result = removeMark(image, found, toPixelRect(decision.area!, image));
  assert.equal(result.method, "mirror");
  // The piece of bar the pill covered is back, close to the real thing.
  let worst = 0;
  for (let x = W - 200; x < W - 60; x += 1) {
    for (let y = 744; y < 752; y += 1) {
      const offset = (y * W + x) * 3;
      worst = Math.max(worst, Math.abs(result.image.data[offset] - clean.data[offset]));
    }
  }
  assert.ok(worst < 40, `worst difference ${worst}`);
});

test("with nothing on the slide that matches, the harmonic fill takes over", () => {
  const image = slide([120, 110, 100], 8);
  mark(image, [250, 250, 250]);
  const found = findMark(image);
  assert.ok(found);
  const decision = decideForDeck([toRelative(found, image), toRelative(found, image)]);
  const mask = markMask(image, found, toPixelRect(decision.area!, image));
  // No candidate can match perfectly, so nothing is accepted.
  const result = fillFromTexture(image, mask, { ...FILL_DEFAULTS, accept: 0, step: 12 });
  assert.equal(result.method, "harmonic");
  const stats = regionStats(result.image, found.x0, found.y0, found.x1, found.y1);
  assert.ok(stats.max < 200, `brightest pixel left ${stats.max}`);
});

test("a gradient is continued across the filled area", () => {
  const image = slide([0, 0, 0]);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const value = Math.round((x / W) * 200);
      const offset = (y * W + x) * 3;
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = value;
    }
  }
  const mask = new Uint8Array(W * H);
  for (let y = 700; y < 740; y += 1) for (let x = 1200; x < 1300; x += 1) mask[y * W + x] = 1;
  const cleaned = fillMasked(image, mask);
  const middle = cleaned.data[(720 * W + 1250) * 3];
  const expected = Math.round((1250 / W) * 200);
  assert.ok(Math.abs(middle - expected) <= 6, `${middle} vs ${expected}`);
});

test("an ornament inside the clean area is left untouched", () => {
  const image = slide([13, 24, 38]);
  // A gold frame bar right above the mark, inside the deck-wide clean area.
  fill(image, 1240, 741, 1376, 745, [186, 150, 80]);
  mark(image, [230, 230, 230]);
  const found = findMark(image);
  assert.ok(found);
  const decision = decideForDeck([toRelative(found, image), toRelative(found, image)]);
  const rect = toPixelRect(decision.area!, image);
  assert.ok(rect.y0 <= 741, "the clean area really does overlap the bar");
  const cleaned = removeMark(image, found, rect).image;
  for (let x = 1240; x < 1376; x += 1) {
    for (let y = 741; y < 745; y += 1) {
      const offset = (y * W + x) * 3;
      assert.equal(cleaned.data[offset], image.data[offset], `bar pixel ${x},${y} changed`);
    }
  }
  assert.equal(findMark(cleaned), null, "the mark itself is gone");
});

test("the mask covers the letters and, on light slides, the pill", () => {
  const dark = slide([13, 24, 38]);
  mark(dark, [230, 230, 230]);
  const darkMark = findMark(dark)!;
  const darkArea = toPixelRect(decideForDeck([toRelative(darkMark, dark)]).area!, dark);
  const darkMask = markMask(dark, darkMark, darkArea);
  const covered = (mask: Uint8Array, x: number, y: number) => mask[y * W + x] !== 0;
  assert.ok(covered(darkMask, 1300, 752), "letters are masked");
  assert.ok(!covered(darkMask, 1300, 742), "plain background above is not");

  const light = slide([175, 170, 167]);
  mark(light, [40, 40, 40], [220, 215, 205]);
  const lightMark = findMark(light)!;
  const lightArea = toPixelRect(decideForDeck([toRelative(lightMark, light)]).area!, light);
  const lightMask = markMask(light, lightMark, lightArea);
  assert.ok(covered(lightMask, 1300, 752), "letters are masked");
  assert.ok(covered(lightMask, 1270, 743), "the pill above the letters is masked too");
});

test("the mask is grown past the letters, and the letters stay core", () => {
  const image = slide([13, 24, 38]);
  mark(image, [230, 230, 230]);
  const found = findMark(image)!;
  const area = toPixelRect(decideForDeck([toRelative(found, image)]).area!, image);
  const tight = markMask(image, found, area, 0);
  const grown = markMask(image, found, area);

  const count = (mask: Uint8Array, value?: number) =>
    mask.reduce(
      (total, cell) => total + ((value === undefined ? cell !== 0 : cell === value) ? 1 : 0),
      0,
    );
  assert.ok(count(grown) > count(tight), "growing adds pixels");
  assert.equal(count(grown, 2), count(tight), "the core is the ungrown mask");

  // Every pixel of the mark is core, so the blend can never mix it back in.
  for (let index = 0; index < tight.length; index += 1) {
    if (tight[index]) assert.equal(grown[index], 2, `pixel ${index} is not core`);
  }
  // The rim lies within MASK_DILATE pixels of the core, and inside the area.
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (grown[y * W + x] !== 1) continue;
      assert.ok(x >= area.x0 && x < area.x1 && y >= area.y0 && y < area.y1, "rim leaves the area");
      let near = false;
      for (let dy = -MASK_DILATE; dy <= MASK_DILATE && !near; dy += 1) {
        for (let dx = -MASK_DILATE; dx <= MASK_DILATE; dx += 1) {
          if (tight[(y + dy) * W + (x + dx)]) near = true;
        }
      }
      assert.ok(near, `rim pixel ${x},${y} is too far from the core`);
    }
  }
});

test("core pixels are repainted outright, with no trace of the original", () => {
  const image = slide([13, 24, 38], 6);
  mark(image, [230, 230, 230]);
  const found = findMark(image)!;
  const area = toPixelRect(decideForDeck([toRelative(found, image)]).area!, image);
  const mask = markMask(image, found, area);
  const cleaned = fillFromTexture(image, mask).image;

  // Brighten the mark hard, then fill through the very same mask. A core pixel
  // that still carried any weight of the original would move with it; the
  // result must be identical instead.
  const louder = { ...image, data: Uint8Array.from(image.data) };
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] !== 2) continue;
    for (let c = 0; c < 3; c += 1) louder.data[index * 3 + c] = 255;
  }
  const loudCleaned = fillFromTexture(louder, mask).image;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] !== 2) continue;
    for (let c = 0; c < 3; c += 1) {
      assert.equal(
        loudCleaned.data[index * 3 + c],
        cleaned.data[index * 3 + c],
        `core pixel ${index} depends on what was under it`,
      );
    }
  }
});

test("with removal on, blocks labelled watermark are not exported", () => {
  const blocks = [
    { role: "title", text: "A" },
    { role: "watermark", text: "Gemini Notebook" },
  ];
  assert.deepEqual(
    exportableBlocks(blocks, { removeWatermark: true }).map((block) => block.role),
    ["title"],
  );
  assert.equal(exportableBlocks(blocks, { removeWatermark: false }).length, 2);
});
