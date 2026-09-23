import test from "node:test";
import assert from "node:assert/strict";
import type { Box2d, RawImage } from "../lib/box-refine.ts";
import { inkBounds, textMask, TEXT_MASK_DEFAULTS } from "../lib/text-mask.ts";

// Synthetic slides only, so every expected number is one written here.

const W = 800;
const H = 450;

function slide(background: [number, number, number], noise = 0, seed = 5): RawImage {
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

/** A line of letter-like strokes: 3 px wide, 7 px apart, `height` px tall. */
function line(
  image: RawImage,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number[],
) {
  for (let cursor = x; cursor < x + width - 3; cursor += 7) {
    fill(image, cursor, y, cursor + 3, y + height, color);
  }
}

/** `lines` lines of text at `pitch` pixels apart, and the box around them. */
function paragraph(
  image: RawImage,
  x: number,
  y: number,
  width: number,
  lines: number,
  pitch: number,
  inkHeight: number,
  color: number[],
): Box2d {
  for (let index = 0; index < lines; index += 1) {
    line(image, x, y + index * pitch, width, inkHeight, color);
  }
  // A box drawn the way a detection would: a little loose around the text.
  const top = y - 3;
  const bottom = y + (lines - 1) * pitch + inkHeight + 3;
  return [
    (top / image.height) * 1000,
    ((x - 4) / image.width) * 1000,
    (bottom / image.height) * 1000,
    ((x + width + 4) / image.width) * 1000,
  ];
}

test("the line pitch is measured from the ink, not from the box", () => {
  const image = slide([20, 30, 50]);
  const box = paragraph(image, 100, 100, 300, 3, 30, 12, [240, 240, 240]);
  const found = textMask(image, box, { textColor: "#F0F0F0", lines: 3 });

  assert.equal(found.confident, true, found.reason ?? "");
  assert.equal(found.lines.length, 3, "three lines of ink");
  assert.equal(found.linePitchPx, 30, "and the pitch they were drawn at");
  assert.equal(found.inkHeightPx, 12, "and the height of one line's ink");
});

test("a box far too short for its text still gives the right pitch", () => {
  const image = slide([20, 30, 50]);
  const box = paragraph(image, 100, 100, 300, 3, 30, 12, [240, 240, 240]);
  // The detected box cut to 70% of its height, the worst ratio measured.
  const short: Box2d = [box[0], box[1], box[0] + (box[2] - box[0]) * 0.7, box[3]];
  const found = textMask(image, short, { textColor: "#F0F0F0" });

  assert.ok(found.linePitchPx !== null);
  assert.equal(found.linePitchPx, 30, "the ink inside the box still sets the pitch");
});

test("one line has no pitch, only an ink height", () => {
  const image = slide([240, 240, 240]);
  const box = paragraph(image, 100, 200, 260, 1, 0, 20, [20, 20, 20]);
  const found = textMask(image, box, { textColor: "#141414", lines: 1 });

  assert.equal(found.confident, true, found.reason ?? "");
  assert.equal(found.linePitchPx, null);
  assert.equal(found.inkHeightPx, 20);
});

test("the mask holds the strokes and not the gaps between them", () => {
  const image = slide([20, 30, 50]);
  const box = paragraph(image, 100, 100, 300, 2, 30, 12, [240, 240, 240]);
  const found = textMask(image, box, { textColor: "#F0F0F0", lines: 2 });
  const at = (x: number, y: number) => found.mask[y * W + x];

  assert.equal(at(101, 105), 1, "a stroke is ink");
  assert.equal(at(105, 105), 0, "the gap between two strokes is not");
  assert.equal(at(101, 125), 0, "and neither is the space between two lines");
  assert.ok(found.coverage > 0 && found.coverage < 0.6);
});

test("the mask is empty outside the block's own box", () => {
  const image = slide([20, 30, 50]);
  // Two paragraphs, one above the other; the second must not leak into the first.
  const first = paragraph(image, 100, 100, 300, 2, 30, 12, [240, 240, 240]);
  paragraph(image, 100, 200, 300, 2, 30, 12, [240, 240, 240]);
  const found = textMask(image, first, { textColor: "#F0F0F0", lines: 2 });

  for (let y = 190; y < 260; y += 1) {
    for (let x = 90; x < 420; x += 1) {
      assert.equal(found.mask[y * W + x], 0, `pixel ${x},${y} of the other paragraph is masked`);
    }
  }
  const bounds = inkBounds(found);
  assert.ok(bounds);
  assert.ok(bounds.y1 <= (first[2] / 1000) * H + 1, "the ink ends inside the block");
});

test("the patch bounds come from the text, not from the loose box", () => {
  const image = slide([20, 30, 50]);
  const box = paragraph(image, 100, 100, 300, 2, 30, 12, [240, 240, 240]);
  const found = textMask(image, box, { textColor: "#F0F0F0", lines: 2 });
  const bounds = inkBounds(found);
  assert.ok(bounds);

  assert.equal(bounds.x0, 100, "the first stroke");
  assert.equal(bounds.y0, 100, "the top of the first line");
  assert.equal(bounds.y1, 142, "the bottom of the second line's ink");
  // The detected box is looser than the ink on every side, which is the point.
  const boxRect = {
    x0: Math.floor((box[1] / 1000) * W),
    y0: Math.floor((box[0] / 1000) * H),
    y1: Math.ceil((box[2] / 1000) * H),
  };
  assert.ok(bounds.x0 >= boxRect.x0 && bounds.y0 >= boxRect.y0 && bounds.y1 <= boxRect.y1);
});

test("a box with nothing in it is not confident, and says why", () => {
  const image = slide([20, 30, 50], 3);
  const box: Box2d = [100, 100, 200, 400];
  const found = textMask(image, box, { textColor: "#F0F0F0" });
  assert.equal(found.confident, false);
  assert.ok(found.reason === "no-lines" || found.reason === "low-ink", found.reason ?? "");
});

test("a solid block of colour is not text, and is refused", () => {
  const image = slide([20, 30, 50]);
  fill(image, 100, 100, 400, 180, [240, 240, 240]);
  const box: Box2d = [(100 / H) * 1000, (100 / W) * 1000, (180 / H) * 1000, (400 / W) * 1000];
  const found = textMask(image, box, { textColor: "#F0F0F0" });
  assert.equal(found.confident, false);
  // Every row of a solid fill is a long straight run, which the ink detector
  // drops as a rule or a frame, so nothing is left to call a line.
  assert.equal(found.reason, "no-lines");
  assert.equal(found.lines.length, 0);
});

test("rows at an uneven pitch are refused rather than averaged", () => {
  const image = slide([20, 30, 50]);
  // Three lines, the last one far below the others: not one block's leading.
  line(image, 100, 100, 300, 12, [240, 240, 240]);
  line(image, 100, 130, 300, 12, [240, 240, 240]);
  line(image, 100, 220, 300, 12, [240, 240, 240]);
  const box: Box2d = [(96 / H) * 1000, (96 / W) * 1000, (236 / H) * 1000, (404 / W) * 1000];
  const found = textMask(image, box, { textColor: "#F0F0F0", lines: 3 });
  assert.equal(found.confident, false);
  assert.equal(found.reason, "uneven-lines");
});

test("a frame line through the box is not taken for text", () => {
  const image = slide([20, 30, 50]);
  const box = paragraph(image, 100, 100, 300, 2, 30, 12, [240, 240, 240]);
  // A gold rule running the full width of the search area, as on the deck.
  fill(image, 0, 118, W, 121, [200, 170, 90]);
  const found = textMask(image, box, { textColor: "#F0F0F0", lines: 2 });
  assert.equal(found.lines.length, 2, "still two lines, the rule is not a third");
  assert.equal(found.mask[119 * W + 500], 0, "and the rule itself is not masked");
});

test("the settings are the only knobs, and the defaults are the documented ones", () => {
  assert.equal(TEXT_MASK_DEFAULTS.rowShare, 0.02);
  assert.equal(TEXT_MASK_DEFAULTS.maxCoverage, 0.6);
  const image = slide([20, 30, 50]);
  const box = paragraph(image, 100, 100, 300, 2, 30, 12, [240, 240, 240]);
  const strict = textMask(image, box, {
    textColor: "#F0F0F0",
    settings: { ...TEXT_MASK_DEFAULTS, maxCoverage: 0.001 },
  });
  assert.equal(strict.confident, false, "a tighter coverage limit refuses the same block");
});
