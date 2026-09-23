/**
 * Measures the chosen text size against the text really on the slide.
 *
 *   npm run test:sizes -- [--deck <file in samples/>] [--model <id>]
 *                         [--media-resolution default|low|medium|high]
 *
 * Cache only: it reads detections that are already in data/cache/gemini and
 * makes no Gemini call and no network request at all. A slide with no cached
 * answer is skipped and counted.
 *
 * For every block it compares one line's height as chosen by lib/layout.ts
 * with one line's height measured in the picture:
 *
 *   several lines  the pitch from the first ink row of one line to the first
 *                  of the next, which is baseline to baseline
 *   one line       the ink height, cap to descender, against the same face's
 *                  own cap-plus-descender ratio from the font file
 *
 * The target (docs/T4-plan.md, 3.1) is that no block sits outside 0.9 to 1.1.
 * The console prints numbers only, never slide text.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";
import { refineBox } from "../lib/box-refine.ts";
import { cacheDirectory, cacheKey, createFileCache } from "../lib/gemini/cache.ts";
import { MEDIA_RESOLUTIONS } from "../lib/gemini/client.ts";
import { parseDetection } from "../lib/gemini/schema.ts";
import { normalizeToPng } from "../lib/jobs/images.ts";
import { isPptxXmlPart, pictureEntries, readPptxStructure } from "../lib/jobs/pptx.ts";
import { readZipEntries, XML_ZIP_LIMITS } from "../lib/jobs/zip.ts";
import { EMU_PER_POINT, imageArea, layoutBlock } from "../lib/layout.ts";
import { createMeasurer, registerFonts } from "../lib/export/font-metrics.ts";
import { textMask } from "../lib/text-mask.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function parseArguments(argv) {
  const options = {
    deck: "Skin_Barrier_Alchemy.pptx",
    model: "gemini-3.5-flash-lite",
    resolution: "default",
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
    } else throw new Error(`unknown argument ${argument}`);
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const directory = cacheDirectory(process.env, ROOT);
if (!directory) throw new Error("the cache is off, so there is nothing to measure from");
const cache = createFileCache(directory);

const bytes = new Uint8Array(await readFile(join(ROOT, "samples", options.deck)));
const deck = readPptxStructure(readZipEntries(bytes, isPptxXmlPart, XML_ZIP_LIMITS));
const wanted = pictureEntries(deck);
const media = readZipEntries(bytes, (name) => wanted.has(name));

registerFonts();
const measure = createMeasurer();
const canvas = createCanvas(10, 10);
const context = canvas.getContext("2d");

/** Ink height of a face at one point: cap height plus descender. */
function inkFactor(face, weight) {
  context.font = `${weight === "bold" ? "bold" : "normal"} 100px "${face}"`;
  const metrics = context.measureText("Hgpy");
  return (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) / 100;
}

const slideSize = { widthEmu: deck.widthEmu, heightEmu: deck.heightEmu };
const slideHeightPt = deck.heightEmu / EMU_PER_POINT;
const rows = [];
let skipped = 0;
let unmeasurable = 0;

for (const slide of deck.slides) {
  if (!slide.picture) continue;
  const png = await normalizeToPng(media.get(slide.picture));
  const cached = await cache.get(cacheKey(png.data, options.model, options.resolution));
  if (!cached) {
    skipped += 1;
    continue;
  }
  const parsed = parseDetection(cached.text);
  if (!parsed.ok) {
    skipped += 1;
    continue;
  }
  const { data, info } = await sharp(png.data)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image = { data, width: info.width, height: info.height, channels: info.channels };
  const { area } = imageArea(image, slideSize);

  for (const raw of parsed.detection.blocks) {
    if (raw.role === "watermark") continue;
    const block = { ...raw, box_2d: [...refineBox(image, raw.box_2d, raw.color).box] };
    const found = textMask(image, block.box_2d, {
      textColor: block.color,
      lines: block.lines,
    });
    const laid = layoutBlock(block, area, slideSize, measure);
    const toPt = (px) => (px / image.height) * slideHeightPt;

    if (!found.confident) {
      unmeasurable += 1;
      rows.push({
        slide: slide.index,
        role: block.role,
        kind: found.reason ?? "unsure",
        ratio: null,
      });
      continue;
    }
    if (found.linePitchPx !== null) {
      const original = toPt(found.linePitchPx);
      const chosen = laid.sizePt * measure.lineFactor(laid.face);
      rows.push({ slide: slide.index, role: block.role, kind: "pitch", original, chosen });
    } else {
      const original = toPt(found.inkHeightPx);
      const chosen = laid.sizePt * inkFactor(laid.face, block.weight);
      rows.push({ slide: slide.index, role: block.role, kind: "ink", original, chosen });
    }
  }
}

console.log(`deck ${options.deck}, model ${options.model} @ ${options.resolution}`);
console.log("slide  role         measure  original pt  chosen pt  ratio");
for (const row of rows) {
  if (row.ratio === null) {
    console.log(
      `${String(row.slide).padStart(5)}  ${row.role.padEnd(11)}  ${row.kind.padEnd(7)}  ` +
        `${"not measured".padStart(11)}`,
    );
    continue;
  }
  const ratio = row.chosen / row.original;
  console.log(
    `${String(row.slide).padStart(5)}  ${row.role.padEnd(11)}  ${row.kind.padEnd(7)}  ` +
      `${row.original.toFixed(1).padStart(11)}  ${row.chosen.toFixed(1).padStart(9)}  ` +
      `${ratio.toFixed(2).padStart(5)}${ratio > 1.1 || ratio < 0.9 ? "  outside" : ""}`,
  );
}

const measured = rows.filter((row) => row.ratio !== null && row.chosen && row.original);
const ratios = measured.map((row) => row.chosen / row.original).sort((a, b) => a - b);
if (ratios.length > 0) {
  const mean = ratios.reduce((total, value) => total + value, 0) / ratios.length;
  const outside = ratios.filter((value) => value > 1.1 || value < 0.9).length;
  console.log(
    `\n${ratios.length} blocks measured, ${unmeasurable} not (mask unsure), ${skipped} slides without a cached answer`,
  );
  console.log(
    `mean ${mean.toFixed(2)}, median ${ratios[Math.floor(ratios.length / 2)].toFixed(2)}, ` +
      `min ${ratios[0].toFixed(2)}, max ${ratios[ratios.length - 1].toFixed(2)}`,
  );
  console.log(
    `outside 0.9 to 1.1: ${outside} of ${ratios.length}` +
      (outside === 0 ? "  (target met)" : "  (target not met)"),
  );
}
