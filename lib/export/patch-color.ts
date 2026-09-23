/**
 * The colour of a cover patch: the median of a thin ring just outside the
 * block, so the patch disappears into the slide instead of showing as a white
 * card. The ring is outside the block, so the block's own text never votes.
 */

import type { RawImage } from "../box-refine.ts";

/** Pixels of background sampled around a block, and how far out the ring sits. */
export const RING = { gap: 2, width: 4 };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

export type PatchColor = {
  /** Upper-case six-digit hex, ready for OOXML. */
  color: string;
  /** The ring's spread; a high one means a textured or gradient background. */
  variation: number;
};

/**
 * `rect` is in pixels of the slide picture. A block at the very edge of the
 * slide has less ring to sample; with nothing to sample at all, white is
 * returned with a variation that flags it.
 */
export function ringColor(
  image: RawImage,
  rect: { x0: number; y0: number; x1: number; y1: number },
  ring = RING,
): PatchColor {
  const { width: W, height: H, channels } = image;
  const outer = {
    x0: Math.max(0, rect.x0 - ring.gap - ring.width),
    y0: Math.max(0, rect.y0 - ring.gap - ring.width),
    x1: Math.min(W, rect.x1 + ring.gap + ring.width),
    y1: Math.min(H, rect.y1 + ring.gap + ring.width),
  };
  const inner = {
    x0: Math.max(0, rect.x0 - ring.gap),
    y0: Math.max(0, rect.y0 - ring.gap),
    x1: Math.min(W, rect.x1 + ring.gap),
    y1: Math.min(H, rect.y1 + ring.gap),
  };
  const samples: number[][] = [[], [], []];
  for (let y = outer.y0; y < outer.y1; y += 1) {
    for (let x = outer.x0; x < outer.x1; x += 1) {
      if (x >= inner.x0 && x < inner.x1 && y >= inner.y0 && y < inner.y1) continue;
      const offset = (y * W + x) * channels;
      for (let c = 0; c < 3; c += 1)
        samples[c].push(image.data[offset + Math.min(c, channels - 1)]);
    }
  }
  if (samples[0].length === 0) return { color: "FFFFFF", variation: 255 };

  const parts = samples.map((channel) => Math.round(median(channel)));
  // How far the ring's own pixels stand from that median, as a mean distance.
  let spread = 0;
  for (let index = 0; index < samples[0].length; index += 1) {
    let worst = 0;
    for (let c = 0; c < 3; c += 1) worst = Math.max(worst, Math.abs(samples[c][index] - parts[c]));
    spread += worst;
  }
  return {
    color: parts
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase(),
    variation: spread / samples[0].length,
  };
}

/** Above this mean spread the background is textured, and the patch will show. */
export const TEXTURED_VARIATION = 12;
