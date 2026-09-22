import test from "node:test";
import assert from "node:assert/strict";
import { backgroundMode, type BackgroundInputs } from "../lib/background-motion.ts";
import { parseHex, toUnitRgb } from "../lib/color.ts";

const ready: BackgroundInputs = {
  reducedMotion: false,
  webgl: true,
  nearViewport: true,
  failed: false,
};

test("background animates only when motion is allowed, WebGL works and it is near view", () => {
  assert.equal(backgroundMode(ready), "animated");
});

test("reduced motion always shows the static motif, even before any WebGL check", () => {
  assert.equal(backgroundMode({ ...ready, reducedMotion: true }), "static");
  assert.equal(
    backgroundMode({ reducedMotion: true, webgl: null, nearViewport: false, failed: false }),
    "static",
  );
});

test("missing or failing WebGL falls back to the static motif", () => {
  assert.equal(backgroundMode({ ...ready, webgl: false }), "static");
  assert.equal(backgroundMode({ ...ready, failed: true }), "static");
  assert.equal(backgroundMode({ ...ready, webgl: false, nearViewport: false }), "static");
});

test("nothing renders until the background nears the viewport and WebGL is checked", () => {
  assert.equal(backgroundMode({ ...ready, nearViewport: false }), "pending");
  assert.equal(backgroundMode({ ...ready, webgl: null }), "pending");
});

test("hex colors parse to channels and unit RGB for the shader", () => {
  assert.deepEqual(parseHex("#b2c5dd"), [178, 197, 221]);
  assert.deepEqual(parseHex(" #FFF "), [255, 255, 255]);
  assert.equal(parseHex("rgb(1 2 3)"), null);
  assert.equal(parseHex("#12345"), null);
  assert.deepEqual(toUnitRgb([255, 0, 51]), [1, 0, 0.2]);
});
