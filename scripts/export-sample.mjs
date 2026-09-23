/**
 * Builds an editable .pptx from a sample deck, using only detections that are
 * already in the development cache. It makes no Gemini call and no network
 * request at all: a slide with no cached answer is exported as background
 * only, which is also what a job with failed slides does (decision 7A).
 *
 *   npm run export:sample -- [--deck <file in samples/>] [--model <id>]
 *                            [--media-resolution default|low|medium|high]
 *                            [--patches] [--no-patches] [--keep-watermark]
 *                            [--out <file>]
 *
 * The output goes to data/export/, which is git-ignored. The console prints
 * counts and sizes only, never slide text.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { refineBox } from "../lib/box-refine.ts";
import { cacheDirectory, cacheKey, createFileCache } from "../lib/gemini/cache.ts";
import { MEDIA_RESOLUTIONS } from "../lib/gemini/client.ts";
import { parseDetection } from "../lib/gemini/schema.ts";
import { normalizeToPng } from "../lib/jobs/images.ts";
import { isPptxXmlPart, pictureEntries, readPptxStructure } from "../lib/jobs/pptx.ts";
import { readZipEntries, XML_ZIP_LIMITS } from "../lib/jobs/zip.ts";
import { COVER_PATCHES_DEFAULT, imageArea, inkRect, layoutSlide } from "../lib/layout.ts";
import { inkBounds, textMask } from "../lib/text-mask.ts";
import { createMeasurer, registerFonts } from "../lib/export/font-metrics.ts";
import { ringColor, TEXTURED_VARIATION } from "../lib/export/patch-color.ts";
import { writeSourceDeck } from "../lib/export/source-deck.ts";
import {
  decideForDeck,
  exportableBlocks,
  findMark,
  removeMark,
  toPixelRect,
  toRelative,
} from "../lib/watermark.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SAMPLES = join(ROOT, "samples");

function parseArguments(argv) {
  const options = {
    deck: "Skin_Barrier_Alchemy.pptx",
    model: "gemini-3.5-flash-lite",
    resolution: "default",
    patches: COVER_PATCHES_DEFAULT,
    removeWatermark: true,
    out: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${argument} needs a value`);
      index += 1;
      return next;
    };
    if (argument === "--deck") options.deck = value();
    else if (argument === "--model") options.model = value();
    else if (argument === "--media-resolution") {
      const resolution = value();
      if (!MEDIA_RESOLUTIONS.includes(resolution)) {
        throw new Error(`--media-resolution must be one of ${MEDIA_RESOLUTIONS.join(", ")}`);
      }
      options.resolution = resolution;
    } else if (argument === "--no-patches") options.patches = false;
    else if (argument === "--keep-watermark") options.removeWatermark = false;
    else if (argument === "--out") options.out = value();
    else throw new Error(`unknown argument ${argument}`);
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));

const directory = cacheDirectory(process.env, ROOT);
if (!directory) throw new Error("the cache is off, so there is nothing to export from");
const cache = createFileCache(directory);

const original = new Uint8Array(await readFile(join(SAMPLES, options.deck)));
const deck = readPptxStructure(readZipEntries(original, isPptxXmlPart, XML_ZIP_LIMITS));
const wanted = pictureEntries(deck);
const media = readZipEntries(original, (name) => wanted.has(name));

// Every slide's picture, as PNG bytes and as raw pixels.
const slides = [];
for (const slide of deck.slides) {
  if (!slide.picture) continue;
  const png = await normalizeToPng(media.get(slide.picture));
  const { data, info } = await sharp(png.data)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  slides.push({
    slide,
    png,
    image: { data, width: info.width, height: info.height, channels: info.channels },
  });
}

// The watermark is decided for the deck as a whole, from the pixels only.
const decision = decideForDeck(
  slides.map(({ image }) => {
    const rect = findMark(image);
    return rect ? toRelative(rect, image) : null;
  }),
);
const cleanDeck = options.removeWatermark && decision.remove;

const missing = registerFonts().missing;
if (missing.length > 0)
  console.log(`fonts not found, measurement is approximate: ${missing.length}`);
const measure = createMeasurer();

const exports = [];
let blocksTotal = 0;
let fromCache = 0;
let textured = 0;
const fills = new Map();

for (const entry of slides) {
  const { slide, png, image } = entry;
  let cleaned = null;
  const position = slides.indexOf(entry);
  if (cleanDeck && decision.slides[position]) {
    const letters = findMark(image);
    const result = removeMark(image, letters, toPixelRect(decision.area, image));
    fills.set(result.method, (fills.get(result.method) ?? 0) + 1);
    cleaned = await sharp(Buffer.from(result.image.data), {
      raw: { width: image.width, height: image.height, channels: image.channels },
    })
      .png()
      .toBuffer();
    entry.image = result.image;
  }

  if (slide.mixed) continue; // decision 2A: mixed slides keep their own shapes

  const key = cacheKey(png.data, options.model, options.resolution);
  const cached = await cache.get(key);
  if (!cached) {
    // No detection: the slide still gets its cleaned background, nothing else.
    if (cleaned) exports.push({ index: slide.index, layout: emptyLayout(), picture: cleaned });
    continue;
  }
  const parsed = parseDetection(cached.text);
  if (!parsed.ok) {
    console.log(`slide ${slide.index}: cached answer rejected (${parsed.reason})`);
    continue;
  }
  fromCache += 1;

  const blocks = exportableBlocks(parsed.detection.blocks, {
    removeWatermark: cleanDeck,
  }).map((block) => {
    const refined = refineBox(entry.image, block.box_2d, block.color);
    return { ...block, box_2d: refined.box };
  });
  blocksTotal += blocks.length;

  const { area } = imageArea(image, { widthEmu: deck.widthEmu, heightEmu: deck.heightEmu });
  const masks = blocks.map((block) =>
    textMask(entry.image, block.box_2d, { textColor: block.color, lines: block.lines }),
  );
  const layout = layoutSlide(
    blocks,
    area,
    { widthEmu: deck.widthEmu, heightEmu: deck.heightEmu },
    measure,
    { coverPatches: options.patches },
    masks.map((found) => ({
      linePitchPx: found.linePitchPx,
      inkHeightPx: found.inkHeightPx,
      imageHeightPx: image.height,
      confident: found.confident,
    })),
    masks.map((found) => {
      const bounds = inkBounds(found);
      return bounds ? inkRect(bounds, image, area) : undefined;
    }),
  );

  const patchColors = layout.blocks.map((laid) => {
    const [ymin, xmin, ymax, xmax] = laid.block.box_2d;
    const found = ringColor(entry.image, {
      x0: Math.round((Math.min(xmin, xmax) / 1000) * image.width),
      y0: Math.round((Math.min(ymin, ymax) / 1000) * image.height),
      x1: Math.round((Math.max(xmin, xmax) / 1000) * image.width),
      y1: Math.round((Math.max(ymin, ymax) / 1000) * image.height),
    });
    if (found.variation > TEXTURED_VARIATION) textured += 1;
    return found.color;
  });

  exports.push({ index: slide.index, layout, picture: cleaned ?? undefined, patchColors });
}

function emptyLayout() {
  return {
    area: { xEmu: 0, yEmu: 0, widthEmu: deck.widthEmu, heightEmu: deck.heightEmu },
    blocks: [],
  };
}

const result = writeSourceDeck(original, deck, exports);
const outDirectory = join(ROOT, "data", "export");
await mkdir(outDirectory, { recursive: true });
const name = options.out ?? `${options.deck.replace(/\.pptx$/i, "")} (editable).pptx`;
const file = join(outDirectory, name);
await writeFile(file, result.archive);

console.log(
  [
    `deck ${deck.slides.length} slides, ${slides.length} with a picture`,
    `detections from cache ${fromCache}, blocks exported ${blocksTotal}`,
    `watermark ${cleanDeck ? `removed on ${decision.slides.filter(Boolean).length} slides` : "kept"}` +
      (fills.size > 0
        ? ` (${[...fills].map(([how, count]) => `${how} ${count}`).join(", ")})`
        : ""),
    `cover patches ${options.patches ? "on" : "off"}${textured > 0 ? `, ${textured} on textured background` : ""}`,
    `slides written ${result.slidesWritten}, shapes added ${result.shapesWritten}`,
    `output ${(result.archive.length / 1024 / 1024).toFixed(1)} MB: ${file}`,
  ].join("\n"),
);
