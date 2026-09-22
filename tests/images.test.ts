import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  checkDimensions,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  normalizeToPng,
  rawToPng,
} from "../lib/jobs/images.ts";

// Every fixture is generated here with sharp. Nothing in samples/ is read.

function solid(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: "#123456" } });
}

test("unreasonable image dimensions are refused before any decoding", () => {
  assert.equal(checkDimensions(1920, 1080), null);
  assert.equal(checkDimensions(MAX_IMAGE_DIMENSION + 1, 10), "too-wide");
  assert.equal(checkDimensions(10, MAX_IMAGE_DIMENSION + 1), "too-wide");
  // Under the per-side limit but far past the pixel limit.
  assert.equal(checkDimensions(19_000, 19_000), "too-many-pixels");
  assert.ok(19_000 * 19_000 > MAX_IMAGE_PIXELS);
  assert.equal(checkDimensions(2, 2), "too-small");
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(checkDimensions(bad, 100), "unreadable", String(bad));
  }
});

test("a PNG whose header claims a huge size is refused, not decoded", async () => {
  const bytes = await solid(32, 32).png().toBuffer();
  const tampered = Buffer.from(bytes);
  // IHDR width and height live at byte 16 and 20.
  tampered.writeUInt32BE(60_000, 16);
  tampered.writeUInt32BE(60_000, 20);
  await assert.rejects(() => normalizeToPng(tampered), /image rejected/);
});

test("a PNG and a JPEG both come out as PNG at their own size", async () => {
  for (const encoded of [
    await solid(320, 180).png().toBuffer(),
    await solid(320, 180).jpeg().toBuffer(),
  ]) {
    const image = await normalizeToPng(encoded);
    assert.equal(image.width, 320);
    assert.equal(image.height, 180);
    assert.deepEqual(Array.from(image.data.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  }
});

test("EXIF orientation is applied, so a rotated photo is not sideways", async () => {
  // Orientation 6 means "rotate 90 degrees clockwise on display".
  const sideways = await sharp({
    create: { width: 400, height: 200, channels: 3, background: "#123456" },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  assert.equal((await sharp(sideways).metadata()).orientation, 6, "the fixture must carry the tag");
  const image = await normalizeToPng(sideways);
  assert.equal(image.width, 200);
  assert.equal(image.height, 400);
});

test("bytes that are not an image at all are refused", async () => {
  await assert.rejects(() => normalizeToPng(new Uint8Array([1, 2, 3, 4, 5])), /image rejected/);
  await assert.rejects(() => normalizeToPng(new Uint8Array()), /image rejected/);
});

test("raw pixels are wrapped without resampling", async () => {
  const width = 64;
  const height = 32;
  const rgb = new Uint8Array(width * height * 3).fill(200);
  const image = await rawToPng(rgb, width, height, 3);
  assert.equal(image.width, width);
  assert.equal(image.height, height);

  // A buffer shorter than the declared size is a mismatch, not a crash.
  await assert.rejects(() => rawToPng(new Uint8Array(10), width, height, 3), /image rejected/);
  await assert.rejects(() => rawToPng(rgb, 0, height, 3), /image rejected/);
});
