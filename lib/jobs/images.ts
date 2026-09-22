import sharp from "sharp";

// A slide is a slide, not a satellite photo. Anything past these is either a
// mistake or a decompression bomb, and both are refused before sharp is asked
// to allocate a pixel buffer.
export const MAX_IMAGE_PIXELS = 100_000_000;
export const MAX_IMAGE_DIMENSION = 20_000;
export const MIN_IMAGE_DIMENSION = 8;

export type ImageRejection = "too-many-pixels" | "too-wide" | "too-small" | "unreadable";

export class ImageRejectedError extends Error {
  readonly reason: ImageRejection;
  constructor(reason: ImageRejection) {
    super(`image rejected: ${reason}`);
    this.name = "ImageRejectedError";
    this.reason = reason;
  }
}

/** Pure size check, applied to header dimensions before anything is decoded. */
export function checkDimensions(width: number, height: number): ImageRejection | null {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    return "unreadable";
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) return "too-wide";
  if (width * height > MAX_IMAGE_PIXELS) return "too-many-pixels";
  if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) return "too-small";
  return null;
}

function assertDimensions(width: number, height: number): void {
  const rejection = checkDimensions(width, height);
  if (rejection) throw new ImageRejectedError(rejection);
}

export type NormalizedImage = { data: Buffer; width: number; height: number };

// limitInputPixels makes sharp itself refuse an oversized image even if a
// header lied and the real dimensions only appear during decoding.
function open(input: Uint8Array) {
  return sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true });
}

/** Decodes an uploaded PNG or JPEG, applies EXIF rotation and re-encodes as PNG. */
export async function normalizeToPng(input: Uint8Array): Promise<NormalizedImage> {
  let width: number;
  let height: number;
  try {
    const metadata = await open(input).metadata();
    width = metadata.width ?? 0;
    height = metadata.height ?? 0;
  } catch {
    throw new ImageRejectedError("unreadable");
  }
  // EXIF orientations 5 to 8 swap the axes, so check both ways round.
  assertDimensions(width, height);

  try {
    const { data, info } = await open(input)
      .rotate()
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new ImageRejectedError("unreadable");
  }
}

/** Wraps raw pixels that came out of pdf.js at their native resolution. */
export async function rawToPng(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: 3 | 4,
): Promise<NormalizedImage> {
  assertDimensions(width, height);
  if (raw.length < width * height * channels) throw new ImageRejectedError("unreadable");
  const { data, info } = await sharp(raw, {
    raw: { width, height, channels },
    limitInputPixels: MAX_IMAGE_PIXELS,
  })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
