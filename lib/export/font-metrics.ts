/**
 * The only part of the export that opens a font file. It measures text with
 * the same files PowerPoint uses, so a line that fits here fits there; every
 * decision made from these numbers lives in lib/layout.ts, which stays pure.
 */

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import type { Measurer } from "../layout.ts";

/** Measured at this size and divided by it, so a width is per point. */
const REFERENCE_SIZE = 100;

/** The faces lib/layout.ts maps to, and the files they live in on Windows. */
const FONT_FILES: Record<string, string[]> = {
  Arial: ["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"],
  Georgia: ["georgia.ttf", "georgiab.ttf", "georgiai.ttf", "georgiaz.ttf"],
  Consolas: ["consola.ttf", "consolab.ttf", "consolai.ttf", "consolaz.ttf"],
  Bahnschrift: ["bahnschrift.ttf"],
};

let registered = false;

/**
 * Registers the faces once. A missing file is not fatal: canvas falls back to
 * a default face, the measurement is then approximate, and the caller is told
 * which faces were missing so it can be reported rather than hidden.
 */
export function registerFonts(directory = "C:\\Windows\\Fonts"): { missing: string[] } {
  const missing: string[] = [];
  if (registered) return { missing };
  for (const files of Object.values(FONT_FILES)) {
    for (const file of files) {
      const path = `${directory}\\${file}`;
      if (!GlobalFonts.registerFromPath(path)) missing.push(file);
    }
  }
  registered = true;
  return { missing };
}

/**
 * A measurer backed by the real font files. Widths come from the canvas text
 * metrics; the line factor comes from the face's own ascent and descent, which
 * is what PowerPoint uses for single line spacing.
 */
export function createMeasurer(): Measurer {
  const canvas = createCanvas(10, 10);
  const context = canvas.getContext("2d");
  const widths = new Map<string, number>();
  const factors = new Map<string, number>();

  const selectFont = (face: string, weight: "regular" | "bold", italic: boolean) => {
    const style = italic ? "italic" : "normal";
    const boldness = weight === "bold" ? "bold" : "normal";
    context.font = `${style} ${boldness} ${REFERENCE_SIZE}px "${face}"`;
  };

  return {
    width(text, face, weight, italic) {
      const key = `${face}|${weight}|${italic}|${text}`;
      const known = widths.get(key);
      if (known !== undefined) return known;
      selectFont(face, weight, italic);
      const measured = context.measureText(text).width / REFERENCE_SIZE;
      widths.set(key, measured);
      return measured;
    },
    lineFactor(face) {
      const known = factors.get(face);
      if (known !== undefined) return known;
      selectFont(face, "regular", false);
      // "Hg" reaches both the ascender and the descender of any of these faces.
      const metrics = context.measureText("Hg");
      const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent;
      const descent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent;
      const factor = (ascent + descent) / REFERENCE_SIZE;
      // A face whose metrics cannot be read must not silently collapse a line.
      const safe = Number.isFinite(factor) && factor > 0.5 ? factor : 1.2;
      factors.set(face, safe);
      return safe;
    },
  };
}
