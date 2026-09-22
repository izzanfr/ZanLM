import test from "node:test";
import assert from "node:assert/strict";
import { refineBox, type Box2d, type RawImage } from "../lib/box-refine.ts";
import { intersectionOverUnion } from "../lib/detect-metrics.ts";

// Synthetic slides only: glyph-like strokes on flat or textured backgrounds.

const W = 1376;
const H = 768;

function slide(background: [number, number, number], noise = 0, seed = 7): RawImage {
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

/** One line of "text": strokes 3 px wide, 5 px apart, words split by 14 px. */
function textLine(
  image: RawImage,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number[],
) {
  let cursor = x;
  let letter = 0;
  while (cursor < x + width - 3) {
    const tall = letter % 3 === 0 ? height : Math.round(height * 0.7);
    fill(image, cursor, y + height - tall, cursor + 3, y + height, color);
    letter += 1;
    cursor += letter % 6 === 0 ? 14 : 5;
  }
}

/** The true box of what was drawn, in 0-1000, as [ymin, xmin, ymax, xmax]. */
const truth = (x0: number, y0: number, x1: number, y1: number): Box2d => [
  (y0 / H) * 1000,
  (x0 / W) * 1000,
  (y1 / H) * 1000,
  (x1 / W) * 1000,
];

/** Gemini's habit on the sample deck: shifted up and too wide. */
function geminiLike(box: Box2d, upPixels: number, widen: number): Box2d {
  const [ymin, xmin, ymax, xmax] = box;
  const up = (upPixels / H) * 1000;
  const extra = ((xmax - xmin) * (widen - 1)) / 2;
  return [ymin - up, xmin - extra, ymax - up, xmax + extra];
}

test("a shifted, too-wide box is pulled onto the text", () => {
  const image = slide([20, 30, 60]);
  textLine(image, 300, 400, 500, 28, [240, 200, 120]);
  textLine(image, 300, 440, 420, 28, [240, 200, 120]);
  const exact = truth(300, 400, 800, 468);
  const rough = geminiLike(exact, 12, 1.2);
  const before = intersectionOverUnion(rough, exact);
  const result = refineBox(image, rough);
  assert.ok(result.refined, result.refined ? "" : result.reason);
  const after = intersectionOverUnion(result.box, exact);
  assert.ok(after > 0.85, `IoU after ${after.toFixed(2)}`);
  assert.ok(after > before + 0.1, `IoU ${before.toFixed(2)} -> ${after.toFixed(2)}`);
});

test("dark text on a light slide works the same way", () => {
  const image = slide([235, 232, 228]);
  textLine(image, 150, 230, 450, 24, [30, 30, 30]);
  const exact = truth(150, 230, 600, 254);
  const result = refineBox(image, geminiLike(exact, 10, 1.15));
  assert.ok(result.refined);
  assert.ok(intersectionOverUnion(result.box, exact) > 0.8);
});

test("a textured background does not read as text", () => {
  const image = slide([200, 180, 140], 22);
  textLine(image, 400, 300, 380, 26, [40, 30, 20]);
  const exact = truth(400, 300, 780, 326);
  const result = refineBox(image, geminiLike(exact, 8, 1.2));
  assert.ok(result.refined, result.refined ? "" : result.reason);
  assert.ok(intersectionOverUnion(result.box, exact) > 0.8);
});

test("a neighbouring block the box only touches is not pulled in", () => {
  const image = slide([20, 30, 60]);
  textLine(image, 300, 300, 400, 28, [240, 240, 240]); // heading above
  textLine(image, 300, 360, 400, 24, [240, 240, 240]); // the block itself
  const exact = truth(300, 360, 700, 384);
  // Gemini's box reaches a few pixels into the heading.
  const rough: Box2d = [
    ((350 - 0) / H) * 1000,
    (280 / W) * 1000,
    (386 / H) * 1000,
    (720 / W) * 1000,
  ];
  const result = refineBox(image, rough);
  assert.ok(result.refined);
  assert.ok(intersectionOverUnion(result.box, exact) > 0.8, "the heading must stay out");
  assert.ok(result.box[0] > (340 / H) * 1000, "the top edge stays below the heading");
});

test("frame lines around a card are ignored", () => {
  const image = slide([230, 215, 180]);
  fill(image, 270, 250, 273, 500, [120, 90, 40]); // left frame, full height of the search area
  fill(image, 830, 250, 833, 500, [120, 90, 40]); // right frame
  textLine(image, 320, 360, 440, 24, [30, 25, 20]);
  const exact = truth(320, 360, 760, 384);
  const result = refineBox(image, geminiLike(exact, 6, 1.2));
  assert.ok(result.refined);
  assert.ok(intersectionOverUnion(result.box, exact) > 0.8);
});

test("ornaments in another color are ignored when the text color is known", () => {
  const image = slide([20, 30, 60]);
  textLine(image, 400, 400, 360, 26, [245, 245, 245]); // white text
  // Gold ornaments just above and to the right, inside the search area.
  fill(image, 420, 382, 740, 386, [200, 160, 60]);
  fill(image, 766, 395, 776, 430, [200, 160, 60]);
  const exact = truth(400, 400, 760, 426);
  const rough = geminiLike(exact, 8, 1.1);
  const withColor = refineBox(image, rough, "#F5F5F5");
  assert.ok(withColor.refined, withColor.refined ? "" : withColor.reason);
  assert.ok(intersectionOverUnion(withColor.box, exact) > 0.8);
  // A wrong color that matches almost nothing falls back to contrast alone
  // instead of refusing outright.
  const wrongColor = refineBox(image, rough, "#00FF00");
  assert.ok(wrongColor.box.length === 4);
});

test("growth is bounded, and a result past the cap is refused", async () => {
  const { REFINE_DEFAULTS } = await import("../lib/box-refine.ts");
  const image = slide([20, 30, 60]);
  textLine(image, 300, 400, 700, 26, [245, 245, 245]);
  // Gemini's box covers only the first third of a long line. The sideways
  // search reaches just 1% of the slide, so the box cannot run along the line.
  const narrow = truth(300, 400, 520, 426);
  const bounded = refineBox(image, narrow, "#F5F5F5");
  if (bounded.refined) {
    const grown = (bounded.box[3] - bounded.box[1]) / (narrow[3] - narrow[1]);
    assert.ok(grown <= REFINE_DEFAULTS.maxGrowthX, `grew x${grown.toFixed(2)}`);
  }
  // With a cap below what the ink needs, the result is refused.
  const strict = refineBox(image, narrow, "#F5F5F5", { ...REFINE_DEFAULTS, maxGrowthX: 0.9 });
  assert.ok(!strict.refined && strict.reason === "too-large");
  assert.deepEqual(strict.box, narrow);
});

test("the text color is read from Gemini's hex value", async () => {
  const { parseHexColor } = await import("../lib/box-refine.ts");
  assert.deepEqual(parseHexColor("#FFAA00"), [255, 170, 0]);
  assert.equal(parseHexColor("orange"), null);
  assert.equal(parseHexColor(undefined), null);
});

test("no text inside the box keeps Gemini's box and says why", () => {
  const image = slide([20, 30, 60], 6);
  const rough = truth(300, 300, 700, 340);
  const result = refineBox(image, rough);
  assert.equal(result.refined, false);
  assert.ok(!result.refined && result.reason === "low-contrast");
  assert.deepEqual(result.box, rough);
});

test("a few stray specks are not taken for text", () => {
  const image = slide([20, 30, 60]);
  fill(image, 400, 310, 402, 312, [255, 255, 255]);
  fill(image, 520, 330, 521, 331, [255, 255, 255]);
  const rough = truth(300, 300, 700, 340);
  const result = refineBox(image, rough);
  assert.equal(result.refined, false);
  assert.deepEqual(result.box, rough);
});

test("an unreasonable result falls back to Gemini's box", () => {
  // The only ink near the box is a big block far larger than the box itself.
  const image = slide([20, 30, 60]);
  for (let row = 0; row < 12; row += 1)
    textLine(image, 200, 150 + row * 30, 900, 24, [240, 240, 240]);
  const tiny = truth(500, 290, 540, 305);
  const result = refineBox(image, tiny);
  if (!result.refined) {
    assert.ok(["too-large", "too-small", "moved-too-far", "low-contrast"].includes(result.reason));
    assert.deepEqual(result.box, tiny);
  } else {
    // If it does refine, the result must stay close to the original box.
    assert.ok(intersectionOverUnion(result.box, tiny) >= 0.2);
  }
});

test("an empty box is returned untouched", () => {
  const image = slide([20, 30, 60]);
  const flat: Box2d = [500, 500, 500, 600];
  const result = refineBox(image, flat);
  assert.ok(!result.refined && result.reason === "empty-box");
});
