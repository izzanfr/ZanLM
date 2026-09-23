import test from "node:test";
import assert from "node:assert/strict";
import type { Block } from "../lib/gemini/schema.ts";
import {
  boxToEmu,
  EMU_PER_POINT,
  faceFor,
  imageArea,
  LAYOUT_DEFAULTS,
  layoutBlock,
  layoutSlide,
  linesOf,
  patchFor,
  runsOf,
  SLIDE_16_9,
  SLIDE_4_3,
  slideSizeFor,
  type Measurer,
} from "../lib/layout.ts";

// A measurer with no font file behind it: every glyph is half an em wide and a
// line is 1.2 ems, so every expected number in this file can be worked out by
// hand. The real metrics are exercised by the export test.
const fake: Measurer = {
  width: (text) => text.length * 0.5,
  lineFactor: () => 1.2,
  inkFactor: () => 0.9,
};

const block = (over: Partial<Block> = {}): Block => ({
  text: "Hello",
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

const FULL = { xEmu: 0, yEmu: 0, widthEmu: SLIDE_16_9.widthEmu, heightEmu: SLIDE_16_9.heightEmu };

test("a picture close to the slide ratio fills it, a wide one gets bars", () => {
  const near = imageArea({ width: 1376, height: 768 }, SLIDE_16_9);
  assert.equal(near.letterboxed, false);
  assert.deepEqual(near.area, FULL);

  const wide = imageArea({ width: 2100, height: 900 }, SLIDE_16_9);
  assert.equal(wide.letterboxed, true);
  assert.equal(wide.area.xEmu, 0, "a 21:9 picture is as wide as the slide");
  assert.ok(wide.area.yEmu > 0, "and has bars above and below");
  assert.ok(
    Math.abs(wide.area.yEmu * 2 + wide.area.heightEmu - SLIDE_16_9.heightEmu) <= 1,
    "the bars are the same height, give or take the odd EMU",
  );
  assert.ok(wide.area.yEmu + wide.area.heightEmu <= SLIDE_16_9.heightEmu, "and stays on the slide");

  const square = imageArea({ width: 900, height: 900 }, SLIDE_4_3);
  assert.equal(square.area.yEmu, 0, "a square picture is as tall as the 4:3 slide");
  assert.ok(square.area.xEmu > 0, "and has bars left and right");
  assert.ok(Math.abs(square.area.xEmu * 2 + square.area.widthEmu - SLIDE_4_3.widthEmu) <= 1);
  assert.ok(square.area.xEmu + square.area.widthEmu <= SLIDE_4_3.widthEmu);
});

test("the slide size is the closer of the two layouts", () => {
  assert.deepEqual(slideSizeFor({ width: 1376, height: 768 }), SLIDE_16_9);
  assert.deepEqual(slideSizeFor({ width: 1024, height: 768 }), SLIDE_4_3);
});

test("boxes map into the picture, never onto the bars", () => {
  const { area } = imageArea({ width: 2100, height: 900 }, SLIDE_16_9);
  const whole = boxToEmu([0, 0, 1000, 1000], area);
  assert.deepEqual(whole, area, "the full box is exactly the picture");

  const middle = boxToEmu([400, 400, 600, 600], area);
  assert.ok(Math.abs(middle.xEmu + middle.widthEmu / 2 - SLIDE_16_9.widthEmu / 2) <= 1);
  assert.ok(
    Math.abs(middle.yEmu + middle.heightEmu / 2 - SLIDE_16_9.heightEmu / 2) <= 1,
    "a centred box stays centred",
  );
  assert.ok(middle.yEmu > area.yEmu, "and sits inside the picture, not on a bar");
});

test("a box given upside down or outside the slide is put right", () => {
  const rect = boxToEmu([600, 900, 200, 100], FULL);
  assert.equal(rect.xEmu, Math.round((100 / 1000) * SLIDE_16_9.widthEmu));
  assert.equal(rect.yEmu, Math.round((200 / 1000) * SLIDE_16_9.heightEmu));
  assert.ok(rect.widthEmu > 0 && rect.heightEmu > 0);

  const outside = boxToEmu([-50, -50, 1200, 1200], FULL);
  assert.deepEqual(outside, FULL);
});

test("families map to faces that ship with Windows, handwriting is flagged", () => {
  assert.equal(faceFor("sans", "regular").face, "Arial");
  assert.equal(faceFor("serif", "regular").face, "Georgia");
  assert.equal(faceFor("mono", "regular").face, "Consolas");
  assert.equal(faceFor("display", "regular").face, "Bahnschrift");
  assert.equal(faceFor("display", "bold").face, "Arial", "a bold headline is not condensed");
  assert.equal(faceFor("handwriting", "regular").flagged, true);
});

test("runs and lines: a block without runs is one run, and breaks split lines", () => {
  const plain = block({ text: "One" });
  assert.deepEqual(runsOf(plain), [
    { text: "One", weight: "regular", italic: false, color: "#142B4A" },
  ]);

  const withRuns = block({
    text: "Kondisi: kering",
    runs: [
      { text: "Kondisi:", weight: "bold", italic: false, color: "#FFFFFF" },
      { text: " kering\nlanjut", weight: "regular", italic: true, color: "#CCCCCC" },
    ],
  });
  const lines = linesOf(runsOf(withRuns));
  assert.equal(lines.length, 2, "the newline inside a run starts a line");
  assert.deepEqual(
    lines[0].map((run) => run.text),
    ["Kondisi:", " kering"],
  );
  assert.deepEqual(
    lines[1].map((run) => run.text),
    ["lanjut"],
  );
  assert.equal(lines[0][0].weight, "bold", "each piece keeps its own style");
});

test("the size is the smaller of the height and width limits, rounded down", () => {
  // The box is 100 of 1000 tall: 0.1 x 6,858,000 EMU = 54 pt over 1.2 lines.
  const tall = layoutBlock(block({ text: "ii" }), FULL, SLIDE_16_9, fake);
  assert.equal(tall.sizePt, 45, "45 pt is the height limit, and the short text fits");

  // A long line in the same box is limited by the width instead.
  const long = layoutBlock(block({ text: "A".repeat(60) }), FULL, SLIDE_16_9, fake);
  assert.ok(long.sizePt < 45, "the width limit wins");
  const widthPt = ((400 / 1000) * SLIDE_16_9.widthEmu) / EMU_PER_POINT;
  assert.ok(
    60 * 0.5 * long.sizePt <= widthPt * (1 - LAYOUT_DEFAULTS.widthSafety) + 0.001,
    "and the line really fits inside the safety margin",
  );
  assert.equal(long.sizePt % LAYOUT_DEFAULTS.sizeStep, 0, "sizes land on the half point");
});

test("text is never smaller than the floor, and that is flagged", () => {
  const tiny = layoutBlock(
    block({ text: "A".repeat(4000), box_2d: [100, 100, 110, 120] }),
    FULL,
    SLIDE_16_9,
    fake,
  );
  assert.equal(tiny.sizePt, LAYOUT_DEFAULTS.minimumSize);
  assert.ok(tiny.flags.includes("size-floor"));
});

// The rule the owner asked for on 2026-09-23, after the comparison showed that
// every model returns boxes 7 to 13% too short.
test("the box is tall enough for its own text, whatever the detection said", () => {
  for (const lines of [1, 2, 3, 6]) {
    const text = Array.from({ length: lines }, (_, index) => `Line ${index + 1}`).join("\n");
    for (const height of [400, 200, 100, 40, 10]) {
      const laid = layoutBlock(
        block({ text, lines, box_2d: [100, 100, 100 + height, 600] }),
        FULL,
        SLIDE_16_9,
        fake,
      );
      const needed = laid.sizePt * lines * fake.lineFactor("Arial") * EMU_PER_POINT;
      assert.ok(
        laid.rect.heightEmu >= needed,
        `${lines} lines in a box of ${height}: ${laid.rect.heightEmu} < ${needed}`,
      );
    }
  }
});

test("a detected box cut to 70% of its height still fits its text", () => {
  const text = "Judul dua baris\nyang cukup panjang";
  const full = block({ text, lines: 2, box_2d: [200, 100, 300, 700] });
  const short = block({ ...full, box_2d: [200, 100, 200 + 100 * 0.7, 700] });
  const laidFull = layoutBlock(full, FULL, SLIDE_16_9, fake);
  const laidShort = layoutBlock(short, FULL, SLIDE_16_9, fake);

  const needed = (size: number) => size * 2 * fake.lineFactor("Arial") * EMU_PER_POINT;
  assert.ok(laidShort.rect.heightEmu >= needed(laidShort.sizePt), "the short box still fits");
  assert.equal(laidShort.rect.yEmu, laidFull.rect.yEmu, "and its top edge has not moved");
  assert.ok(laidShort.sizePt <= laidFull.sizePt, "a shorter box only ever means smaller text");
});

test("a box near the bottom moves up instead of losing its text", () => {
  const laid = layoutBlock(
    block({ text: "Tiga\nbaris\npenuh", lines: 3, box_2d: [980, 100, 999, 600] }),
    FULL,
    SLIDE_16_9,
    fake,
  );
  assert.ok(laid.rect.yEmu + laid.rect.heightEmu <= SLIDE_16_9.heightEmu, "it stays on the slide");
  assert.ok(laid.flags.includes("moved-up"));
  const needed = laid.sizePt * 3 * fake.lineFactor("Arial") * EMU_PER_POINT;
  assert.ok(laid.rect.heightEmu >= needed, "and keeps its full height");
});

test("alignment decides which edge stays put", () => {
  const near = { box_2d: [100, 700, 200, 990] as Block["box_2d"], text: "Kanan" };
  const right = layoutBlock(block({ ...near, align: "right" }), FULL, SLIDE_16_9, fake);
  const detected = boxToEmu(near.box_2d, FULL);
  assert.equal(
    right.rect.xEmu + right.rect.widthEmu,
    detected.xEmu + detected.widthEmu,
    "the right edge is kept",
  );
  assert.ok(right.rect.xEmu >= 0, "and the box stays on the slide");

  const centre = layoutBlock(block({ ...near, align: "center" }), FULL, SLIDE_16_9, fake);
  assert.equal(
    centre.rect.xEmu + Math.round(centre.rect.widthEmu / 2),
    detected.xEmu + Math.round(detected.widthEmu / 2),
    "the centre is kept",
  );
});

test("a patch reaches past its block and never leaves the slide", () => {
  const padding = Math.round(SLIDE_16_9.heightEmu * LAYOUT_DEFAULTS.patchPadding);
  const rect = { xEmu: 900000, yEmu: 800000, widthEmu: 500000, heightEmu: 300000 };
  const patch = patchFor(rect, SLIDE_16_9);
  assert.equal(patch.widthEmu, rect.widthEmu + 2 * padding);
  assert.equal(patch.xEmu, rect.xEmu - padding);
  assert.equal(patch.heightEmu, rect.heightEmu + 2 * padding);

  const atTop = patchFor({ ...rect, yEmu: 10 }, SLIDE_16_9);
  assert.equal(atTop.yEmu, 0, "clipped at the top edge rather than going negative");

  const corner = patchFor(
    {
      xEmu: SLIDE_16_9.widthEmu - 100,
      yEmu: SLIDE_16_9.heightEmu - 100,
      widthEmu: 100,
      heightEmu: 100,
    },
    SLIDE_16_9,
  );
  assert.ok(corner.xEmu + corner.widthEmu <= SLIDE_16_9.widthEmu);
  assert.ok(corner.yEmu + corner.heightEmu <= SLIDE_16_9.heightEmu);
});

test("a slide lays out every block, with patches only when they are wanted", () => {
  const blocks = [block({ text: "A" }), block({ text: "B", box_2d: [300, 100, 400, 500] })];
  const on = layoutSlide(blocks, FULL, SLIDE_16_9, fake, { coverPatches: true });
  assert.equal(on.blocks.length, 2);
  assert.ok(on.blocks.every((laid) => laid.patch !== null));

  const off = layoutSlide(blocks, FULL, SLIDE_16_9, fake, { coverPatches: false });
  assert.ok(off.blocks.every((laid) => laid.patch === null));
});

// The rule the owner asked for on 2026-09-23: the size follows the ink on the
// slide, because the detected box is 7 to 13% too short with a wide spread.
test("the size follows the line pitch of the ink, not the detected box", () => {
  const slideHeightPt = SLIDE_16_9.heightEmu / EMU_PER_POINT;
  const imageHeightPx = 768;
  // Two lines 30 px apart on a 768 px picture: the line height in points.
  const pitchPt = (30 / imageHeightPx) * slideHeightPt;
  const ink = { linePitchPx: 30, inkHeightPx: 14, imageHeightPx, confident: true };

  // The same block in a box far too short and in one far too tall: the ink
  // decides, so both come out at the same size.
  const short = layoutBlock(
    block({ text: "Satu\nDua", lines: 2, box_2d: [100, 100, 130, 500] }),
    FULL,
    SLIDE_16_9,
    fake,
    LAYOUT_DEFAULTS,
    ink,
  );
  const tall = layoutBlock(
    block({ text: "Satu\nDua", lines: 2, box_2d: [100, 100, 300, 500] }),
    FULL,
    SLIDE_16_9,
    fake,
    LAYOUT_DEFAULTS,
    ink,
  );
  assert.equal(short.sizePt, tall.sizePt, "the box height no longer decides");
  const chosen = short.sizePt * fake.lineFactor("Arial");
  assert.ok(Math.abs(chosen / pitchPt - 1) <= 0.1, `${chosen} against ${pitchPt}`);
});

test("one line is sized from its ink height", () => {
  const imageHeightPx = 768;
  const ink = { linePitchPx: null, inkHeightPx: 20, imageHeightPx, confident: true };
  const laid = layoutBlock(block({ text: "Judul" }), FULL, SLIDE_16_9, fake, LAYOUT_DEFAULTS, ink);
  const inkPt = (20 / imageHeightPx) * (SLIDE_16_9.heightEmu / EMU_PER_POINT);
  const chosen = laid.sizePt * fake.inkFactor("Arial", "regular");
  assert.ok(Math.abs(chosen / inkPt - 1) <= 0.1, `${chosen} against ${inkPt}`);
});

test("a block whose ink cannot be read falls back to the box, and says so", () => {
  const ink = { linePitchPx: null, inkHeightPx: 0, imageHeightPx: 768, confident: false };
  const laid = layoutBlock(block(), FULL, SLIDE_16_9, fake, LAYOUT_DEFAULTS, ink);
  const without = layoutBlock(block(), FULL, SLIDE_16_9, fake);
  assert.equal(laid.sizePt, without.sizePt);
  assert.ok(laid.flags.includes("size-from-box"));
});

test("a box that would grow into its neighbour is narrowed instead", () => {
  const imageHeightPx = 768;
  // Two blocks side by side, each in a narrow box, with a generous ink pitch:
  // sized from the ink alone they would overlap.
  const left = block({ text: "Kiri panjang sekali", box_2d: [400, 50, 460, 300] });
  const right = block({ text: "Kanan panjang sekali", box_2d: [400, 320, 460, 600] });
  const ink = [
    { linePitchPx: 60, inkHeightPx: 40, imageHeightPx, confident: true },
    { linePitchPx: 60, inkHeightPx: 40, imageHeightPx, confident: true },
  ];
  const layout = layoutSlide([left, right], FULL, SLIDE_16_9, fake, { coverPatches: false }, ink);
  const [a, b] = layout.blocks.map((one) => one.rect);
  const shared =
    Math.max(0, Math.min(a.xEmu + a.widthEmu, b.xEmu + b.widthEmu) - Math.max(a.xEmu, b.xEmu)) *
    Math.max(0, Math.min(a.yEmu + a.heightEmu, b.yEmu + b.heightEmu) - Math.max(a.yEmu, b.yEmu));
  const smaller = Math.min(a.widthEmu * a.heightEmu, b.widthEmu * b.heightEmu);
  assert.ok(shared / smaller <= LAYOUT_DEFAULTS.overlapShare, "the boxes no longer overlap");
  assert.ok(
    layout.blocks.some((one) => one.flags.includes("narrowed-to-fit")),
    "and the block that gave way says so",
  );
});

test("a patch covers the original text, not the new text box", () => {
  // The new box is taller and wider than the text it replaces; the patch has
  // to follow the text, which is what the detected-box patch got wrong.
  const laid = layoutBlock(block({ text: "Judul" }), FULL, SLIDE_16_9, fake);
  const ink = { xEmu: 1_000_000, yEmu: 900_000, widthEmu: 700_000, heightEmu: 120_000 };
  const fromInk = patchFor(ink, SLIDE_16_9);
  const fromBox = patchFor(laid.rect, SLIDE_16_9);

  const padding = Math.round(SLIDE_16_9.heightEmu * LAYOUT_DEFAULTS.patchPadding);
  assert.equal(fromInk.xEmu, ink.xEmu - padding);
  assert.equal(fromInk.widthEmu, ink.widthEmu + 2 * padding);
  assert.notDeepEqual(fromInk, fromBox, "the two rectangles are not the same");

  // Through a slide layout: the patch follows the rectangle it is given.
  const layout = layoutSlide([block()], FULL, SLIDE_16_9, fake, { coverPatches: true }, [], [ink]);
  assert.deepEqual(layout.blocks[0].patch, fromInk);
});

test("with no mask the patch falls back to the new box", () => {
  const layout = layoutSlide([block()], FULL, SLIDE_16_9, fake, { coverPatches: true });
  assert.ok(layout.blocks[0].patch);
  assert.deepEqual(layout.blocks[0].patch, patchFor(layout.blocks[0].rect, SLIDE_16_9));
});
