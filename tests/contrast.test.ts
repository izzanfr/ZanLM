import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contrastRatio, mixRgb, parseHex, type Rgb } from "../lib/color.ts";

// Reads the real runtime tokens so a token change cannot silently break contrast.
const css = readFileSync(new URL("../app/tokens.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing ${selector} block`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const vars: Record<string, string> = {};
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[match[1]] = match[2].trim();
  return vars;
}

const light = block(":root");
const dark = { ...light, ...block('[data-theme="dark"]') };

function color(vars: Record<string, string>, name: string): Rgb {
  const parsed = parseHex(vars[name] ?? "");
  assert.ok(parsed, `--${name} must be a hex color`);
  return parsed;
}

function opacity(vars: Record<string, string>, name: string): number {
  const value = Number(vars[name]);
  assert.ok(value > 0 && value < 1, `--${name} must be between 0 and 1`);
  return value;
}

const AA = 4.5;

for (const [theme, vars] of [
  ["light", light],
  ["dark", dark],
] as const) {
  for (const [surface, opacityName] of [
    ["canvas", "background-motion-opacity"],
    ["surface", "background-motion-opacity-surface"],
  ] as const) {
    test(`${theme}: body text stays WCAG AA over the densest Threads line on ${surface}`, () => {
      // Threads outputs full line color at alpha 1 in a line's center, so the
      // worst case is the line color composited at the container opacity.
      const worst = mixRgb(
        color(vars, surface),
        color(vars, "background-motion"),
        opacity(vars, opacityName),
      );
      for (const text of ["ink", "muted"]) {
        const ratio = contrastRatio(color(vars, text), worst);
        assert.ok(ratio >= AA, `${theme} --${text} on ${surface}: ${ratio.toFixed(2)} < ${AA}`);
      }
    });
  }
}
