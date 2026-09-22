// Pure color helpers shared by runtime code and contrast tests.

export type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parses #rgb or #rrggbb into 0–255 channels. Returns null for anything else. */
export function parseHex(value: string): Rgb | null {
  const trimmed = value.trim();
  if (!HEX.test(trimmed)) return null;
  const digits = trimmed.slice(1);
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  return [0, 2, 4].map((start) =>
    Number.parseInt(full.slice(start, start + 2), 16),
  ) as unknown as Rgb;
}

/** Converts 0–255 channels to the 0–1 range that WebGL shaders expect. */
export function toUnitRgb(rgb: Rgb): [number, number, number] {
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

/** Composites `top` over `bottom` with the given opacity (0–1). */
export function mixRgb(bottom: Rgb, top: Rgb, opacity: number): Rgb {
  return bottom.map((channel, i) => channel * (1 - opacity) + top[i] * opacity) as unknown as Rgb;
}

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * linearChannel(rgb[0]) + 0.7152 * linearChannel(rgb[1]) + 0.0722 * linearChannel(rgb[2])
  );
}

/** WCAG 2.x contrast ratio, from 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
