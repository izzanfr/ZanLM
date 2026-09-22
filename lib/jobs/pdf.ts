import { createRequire } from "node:module";
import { dirname } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { ImageRejectedError, rawToPng, type NormalizedImage } from "./images.ts";
import { analyzePage, renderScale, type DrawOp } from "./pdf-page.ts";

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<PdfjsModule> | null = null;

// pdf.js is loaded on demand: it is a large module and nothing outside the
// extractor needs it.
async function pdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

// pdf.js needs the standard 14 fonts as files to draw text on a rendered page.
// They ship inside pdfjs-dist, which stays an external package at runtime, so
// the folder can be resolved from the installed module rather than copied.
function standardFontsUrl(): string {
  const packageJson = createRequire(import.meta.url).resolve("pdfjs-dist/package.json");
  // pdf.js reads these with fs in Node and wants a trailing separator. It has
  // to be a plain path with forward slashes: a Windows file:// URL ends in an
  // encoded backslash and pdf.js then fails to find any font.
  return `${dirname(packageJson).replaceAll("\\", "/")}/standard_fonts/`;
}

export class PdfError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`pdf rejected: ${reason}`);
    this.name = "PdfError";
    this.reason = reason;
  }
}

export type PdfPageImage = {
  index: number;
  image: NormalizedImage;
  /** "pdf-image" is the embedded picture taken as-is, "pdf-render" is drawn. */
  origin: "pdf-image" | "pdf-render";
  mixed: boolean;
};

// pdf.js ImageKind
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

type PdfImage = { width: number; height: number; kind?: number; data?: Uint8Array };

function isUsableImage(value: unknown): value is PdfImage {
  if (typeof value !== "object" || value === null) return false;
  const image = value as PdfImage;
  return (
    typeof image.width === "number" &&
    typeof image.height === "number" &&
    image.data instanceof Uint8Array &&
    (image.kind === RGB_24BPP || image.kind === RGBA_32BPP)
  );
}

export async function openPdf(data: Uint8Array) {
  const pdf = await pdfjs();
  try {
    return await pdf.getDocument({
      data,
      // Nothing in a slide deck needs forms, and no font may be fetched from
      // the machine or the network: only the fonts pdfjs-dist ships with.
      enableXfa: false,
      disableFontFace: true,
      useSystemFonts: false,
      standardFontDataUrl: standardFontsUrl(),
      // Without this pdf.js hands back an ImageBitmap it cannot produce in
      // Node, instead of the raw pixels the lossless path needs.
      isOffscreenCanvasSupported: false,
      stopAtErrors: false,
    }).promise;
  } catch {
    throw new PdfError("unreadable");
  }
}

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof openPdf>>["getPage"]>>;

async function operatorNames(page: Page): Promise<DrawOp[]> {
  const pdf = await pdfjs();
  const names = new Map<number, string>();
  for (const [name, code] of Object.entries(pdf.OPS)) names.set(code as number, name);
  const list = await page.getOperatorList();
  return list.fnArray.map((code, index) => ({
    name: names.get(code) ?? String(code),
    args: (list.argsArray[index] ?? []) as unknown[],
  }));
}

type ObjectStore = {
  has?: (id: string) => boolean;
  get: (id: string, callback?: (value: unknown) => void) => unknown;
};

/**
 * Resolves an image object that pdf.js fills in asynchronously. An image used
 * by more than one page is kept in commonObjs rather than the page's own
 * store, so both are watched and whichever answers first wins.
 */
function waitForObject(page: Page, id: string, timeoutMs = 10_000): Promise<unknown> {
  const stores = [page.objs, page.commonObjs].filter(Boolean) as unknown as ObjectStore[];
  for (const store of stores) {
    if (store.has?.(id)) {
      try {
        return Promise.resolve(store.get(id));
      } catch {
        // Not actually resolved yet; fall through to the callback route.
      }
    }
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    for (const store of stores) {
      try {
        store.get(id, finish);
      } catch {
        // A store that does not know this id simply never calls back.
      }
    }
  });
}

async function renderPage(page: Page): Promise<NormalizedImage> {
  const scale = renderScale(page.getViewport({ scale: 1 }).width);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  // PDF pages have no background of their own; without this, anything the page
  // leaves untouched comes out transparent instead of white.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  // Straight from the canvas pixels, so the page is encoded once instead of
  // being written to PNG here and decoded again by sharp.
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return rawToPng(
    new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
    canvas.width,
    canvas.height,
    4,
  );
}

export type PdfExtractOptions = {
  maxPages: number;
  onPage?: (index: number, total: number) => void;
  signal?: AbortSignal;
};

export async function extractPdf(
  data: Uint8Array,
  options: PdfExtractOptions,
): Promise<PdfPageImage[]> {
  const document = await openPdf(data);
  if (document.numPages < 1) throw new PdfError("no pages");
  if (document.numPages > options.maxPages) throw new PdfError("too-many-pages");

  const pages: PdfPageImage[] = [];
  try {
    for (let index = 1; index <= document.numPages; index += 1) {
      options.signal?.throwIfAborted();
      const page = await document.getPage(index);
      try {
        pages.push(await extractOnePage(page, index));
      } finally {
        page.cleanup();
      }
      options.onPage?.(index, document.numPages);
    }
  } finally {
    // The worker lives on the loading task, not the document proxy.
    await document.loadingTask.destroy();
  }
  return pages;
}

async function extractOnePage(page: Page, index: number): Promise<PdfPageImage> {
  const viewport = page.getViewport({ scale: 1 });
  const ops = await operatorNames(page);
  const shape = analyzePage(ops, viewport.width, viewport.height);

  if (shape.imageId) {
    // A page that is exactly one full-page picture: take that picture at its
    // own resolution instead of drawing the page at some chosen dpi, so no
    // resampling happens at all.
    const object = await waitForObject(page, shape.imageId);
    if (isUsableImage(object)) {
      try {
        const image = await rawToPng(
          object.data!,
          object.width,
          object.height,
          object.kind === RGBA_32BPP ? 4 : 3,
        );
        return { index, image, origin: "pdf-image", mixed: false };
      } catch (error) {
        // A picture we cannot take as-is is not a reason to lose the page.
        if (!(error instanceof ImageRejectedError)) throw error;
      }
    }
  }

  return { index, image: await renderPage(page), origin: "pdf-render", mixed: shape.mixed };
}
