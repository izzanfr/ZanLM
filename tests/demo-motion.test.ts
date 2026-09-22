import test from "node:test";
import assert from "node:assert/strict";
import { DEMO_CONDITIONS, demoMotionMode, SEPARATED_OFFSETS } from "../lib/demo-motion.ts";

test("reduced motion always gives the static demo, on every screen size", () => {
  assert.equal(demoMotionMode({ spacious: true, reducedMotion: true }), "static");
  assert.equal(demoMotionMode({ spacious: false, reducedMotion: true }), "static");
});

test("only spacious screens with motion allowed pin the demo", () => {
  assert.equal(demoMotionMode({ spacious: true, reducedMotion: false }), "pinned");
  assert.equal(demoMotionMode({ spacious: false, reducedMotion: false }), "enter");
});

test("pin requires both width and height, and reduced motion uses the standard query", () => {
  assert.match(DEMO_CONDITIONS.spacious, /min-width: 1024px/);
  assert.match(DEMO_CONDITIONS.spacious, /min-height: 700px/);
  assert.equal(DEMO_CONDITIONS.reducedMotion, "(prefers-reduced-motion: reduce)");
});

test("separated layers lift 12/24/36 px as in the T0 storyboard", () => {
  assert.deepEqual(
    [SEPARATED_OFFSETS.panels.y, SEPARATED_OFFSETS.objects.y, SEPARATED_OFFSETS.text.y],
    [-12, -24, -36],
  );
});
