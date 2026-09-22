/**
 * Deciding whether a PDF page is "one full-page picture and nothing else".
 *
 * This is pure: it works on a list of drawing operator names and arguments, so
 * it can be tested without pdf.js. lib/jobs/pdf.ts feeds it the real operator
 * list.
 */

export type DrawOp = { name: string; args: readonly unknown[] };

/** [a, b, c, d, e, f] in PDF order. */
export type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, base: Matrix): Matrix {
  return [
    m[0] * base[0] + m[1] * base[2],
    m[0] * base[1] + m[1] * base[3],
    m[2] * base[0] + m[3] * base[2],
    m[2] * base[1] + m[3] * base[3],
    m[4] * base[0] + m[5] * base[2] + base[4],
    m[4] * base[1] + m[5] * base[3] + base[5],
  ];
}

const IMAGE_OPS = new Set([
  "paintImageXObject",
  "paintImageXObjectRepeat",
  "paintInlineImageXObject",
  "paintInlineImageXObjectGroup",
  "paintImageMaskXObject",
  "paintImageMaskXObjectRepeat",
  "paintImageMaskXObjectGroup",
  "paintJpegXObject",
  "paintSolidColorImageMask",
]);

// Anything that puts marks on the page other than the one image. A form
// XObject counts because its contents are a separate operator list we do not
// look inside.
const MARKING_OPS = new Set([
  "showText",
  "showSpacedText",
  "nextLineShowText",
  "nextLineSetSpacingShowText",
  "fill",
  "eoFill",
  "stroke",
  "closeStroke",
  "fillStroke",
  "eoFillStroke",
  "closeFillStroke",
  "closeEOFillStroke",
  "shadingFill",
  "paintFormXObjectBegin",
]);

export type PageShape = {
  /** Id of the single full-page image, when the page is exactly that. */
  imageId: string | null;
  /** How much of the page the image covers, 0 when there is no usable image. */
  coverage: number;
  /** The page carries something besides one full-page picture. */
  mixed: boolean;
};

/** Below this, the picture is not the whole page. */
export const FULL_PAGE_COVERAGE = 0.98;

function boundingBox(ctm: Matrix) {
  // The image occupies the unit square, mapped through the current matrix.
  const xs = [ctm[4], ctm[0] + ctm[4], ctm[2] + ctm[4], ctm[0] + ctm[2] + ctm[4]];
  const ys = [ctm[5], ctm[1] + ctm[5], ctm[3] + ctm[5], ctm[1] + ctm[3] + ctm[5]];
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    bottom: Math.min(...ys),
    top: Math.max(...ys),
  };
}

export function pageCoverage(ctm: Matrix, pageWidth: number, pageHeight: number): number {
  if (pageWidth <= 0 || pageHeight <= 0) return 0;
  const box = boundingBox(ctm);
  const visibleWidth = Math.max(0, Math.min(box.right, pageWidth) - Math.max(box.left, 0));
  const visibleHeight = Math.max(0, Math.min(box.top, pageHeight) - Math.max(box.bottom, 0));
  return (visibleWidth * visibleHeight) / (pageWidth * pageHeight);
}

export function analyzePage(
  ops: readonly DrawOp[],
  pageWidth: number,
  pageHeight: number,
): PageShape {
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  let images = 0;
  let marked = false;
  let imageId: string | null = null;
  let coverage = 0;

  for (const op of ops) {
    if (op.name === "save") {
      stack.push(ctm);
      continue;
    }
    if (op.name === "restore") {
      ctm = stack.pop() ?? IDENTITY;
      continue;
    }
    if (op.name === "transform") {
      const values = op.args.slice(0, 6).map(Number);
      if (values.length === 6 && values.every(Number.isFinite)) {
        ctm = multiply(values as unknown as Matrix, ctm);
      }
      continue;
    }
    if (MARKING_OPS.has(op.name)) {
      marked = true;
      continue;
    }
    if (IMAGE_OPS.has(op.name)) {
      images += 1;
      // Only a plain image XObject can be lifted out as-is; masks and repeats
      // are composites and are left to the renderer.
      if (op.name === "paintImageXObject" && typeof op.args[0] === "string") {
        imageId = op.args[0];
        coverage = pageCoverage(ctm, pageWidth, pageHeight);
      }
      continue;
    }
  }

  const single = images === 1 && imageId !== null && !marked && coverage >= FULL_PAGE_COVERAGE;
  return {
    imageId: single ? imageId : null,
    coverage,
    mixed: !single,
  };
}

/** At least 1600 px wide and never below 144 dpi, with a ceiling on the output. */
export const MIN_RENDER_WIDTH = 1600;
export const MIN_RENDER_SCALE = 2;
export const MAX_RENDER_WIDTH = 6000;

export function renderScale(pageWidth: number): number {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) return MIN_RENDER_SCALE;
  const scale = Math.max(MIN_RENDER_WIDTH / pageWidth, MIN_RENDER_SCALE);
  return Math.min(scale, MAX_RENDER_WIDTH / pageWidth);
}
