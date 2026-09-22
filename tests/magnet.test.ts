import test from "node:test";
import assert from "node:assert/strict";
import { MAGNET_SETTINGS, magnetEnabled } from "../lib/magnet.ts";

test("magnet runs only for fine pointers with motion allowed", () => {
  assert.equal(magnetEnabled({ reducedMotion: false, finePointer: true }), true);
  assert.equal(magnetEnabled({ reducedMotion: true, finePointer: true }), false);
  assert.equal(magnetEnabled({ reducedMotion: false, finePointer: false }), false);
  assert.equal(magnetEnabled({ reducedMotion: true, finePointer: false }), false);
});

test("magnet pull stays subtle: at most about 10 px for a 180 x 50 px button", () => {
  const maxX = (180 / 2 + MAGNET_SETTINGS.padding) / MAGNET_SETTINGS.strength;
  const maxY = (50 / 2 + MAGNET_SETTINGS.padding) / MAGNET_SETTINGS.strength;
  assert.ok(maxX <= 10.5, `max horizontal pull ${maxX.toFixed(1)} px`);
  assert.ok(maxY <= 5, `max vertical pull ${maxY.toFixed(1)} px`);
});
