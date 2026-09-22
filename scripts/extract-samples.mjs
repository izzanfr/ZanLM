/**
 * Runs the real extractors over every file in the git-ignored samples/ folder
 * and prints counts, sizes and timings.
 *
 * It never prints slide text, notes or file contents, and it writes nothing
 * into the repository. Run it with:
 *
 *   npm run test:extract
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectType, SIGNATURE_BYTES, sortImageNames } from "../lib/jobs/core.ts";
import { normalizeToPng } from "../lib/jobs/images.ts";
import { extractPdf } from "../lib/jobs/pdf.ts";
import { isPptxXmlPart, pictureEntries, readPptxStructure } from "../lib/jobs/pptx.ts";
import { readZipEntries, XML_ZIP_LIMITS } from "../lib/jobs/zip.ts";

const SAMPLES = fileURLToPath(new URL("../samples/", import.meta.url));

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function summarize(label, values) {
  if (values.length === 0) return `${label}: none`;
  const sorted = [...values].sort((a, b) => a - b);
  return `${label}: min ${sorted[0]}, median ${sorted[Math.floor(sorted.length / 2)]}, max ${sorted.at(-1)}`;
}

async function reportPptx(bytes) {
  const started = Date.now();
  const deck = readPptxStructure(readZipEntries(bytes, isPptxXmlPart, XML_ZIP_LIMITS));
  const structureMs = Date.now() - started;

  const wanted = pictureEntries(deck);
  const media = readZipEntries(bytes, (name) => wanted.has(name));
  const mediaMs = Date.now() - started - structureMs;

  const widths = [];
  const heights = [];
  let decoded = 0;
  let pngBytes = 0;
  const decodeStart = Date.now();
  for (const slide of deck.slides) {
    const picture = slide.picture ? media.get(slide.picture) : undefined;
    if (!picture) continue;
    const image = await normalizeToPng(picture);
    widths.push(image.width);
    heights.push(image.height);
    pngBytes += image.data.byteLength;
    decoded += 1;
  }
  const decodeMs = Date.now() - decodeStart;

  console.log(`  slide size: ${deck.widthEmu} x ${deck.heightEmu} EMU`);
  console.log(`  slides: ${deck.slides.length}`);
  console.log(`  slides with a usable picture: ${decoded}`);
  console.log(`  slides flagged mixed: ${deck.slides.filter((slide) => slide.mixed).length}`);
  console.log(`  hidden slides: ${deck.slides.filter((slide) => slide.hidden).length}`);
  console.log(`  slides with speaker notes: ${deck.slides.filter((slide) => slide.notes).length}`);
  console.log(`  ${summarize("picture width", widths)}`);
  console.log(`  ${summarize("picture height", heights)}`);
  console.log(`  normalized PNG total: ${megabytes(pngBytes)}`);
  console.log(
    `  timing: structure ${structureMs} ms, media inflate ${mediaMs} ms, decode ${decodeMs} ms`,
  );
}

async function reportPdf(bytes) {
  const started = Date.now();
  const pages = await extractPdf(bytes, { maxPages: 500 });
  const elapsed = Date.now() - started;
  const lossless = pages.filter((page) => page.origin === "pdf-image").length;
  console.log(`  pages: ${pages.length}`);
  console.log(`  original picture taken as-is: ${lossless}`);
  console.log(`  rendered: ${pages.length - lossless}`);
  console.log(`  pages flagged mixed: ${pages.filter((page) => page.mixed).length}`);
  console.log(
    `  ${summarize(
      "width",
      pages.map((page) => page.image.width),
    )}`,
  );
  console.log(
    `  normalized PNG total: ${megabytes(pages.reduce((sum, page) => sum + page.image.data.byteLength, 0))}`,
  );
  console.log(`  timing: ${elapsed} ms (${Math.round(elapsed / pages.length)} ms per page)`);
}

async function reportImage(bytes) {
  const started = Date.now();
  const image = await normalizeToPng(bytes);
  console.log(`  ${image.width} x ${image.height}, ${megabytes(image.data.byteLength)} as PNG`);
  console.log(`  timing: ${Date.now() - started} ms`);
}

let names;
try {
  names = sortImageNames(await readdir(SAMPLES));
} catch {
  console.log("No samples/ folder. Put a deck there first; it is git-ignored.");
  process.exit(0);
}
if (names.length === 0) {
  console.log("samples/ is empty. Put a deck there first; it is git-ignored.");
  process.exit(0);
}

let failures = 0;
for (const name of names) {
  const bytes = new Uint8Array(await readFile(join(SAMPLES, name)));
  const type = detectType(bytes.subarray(0, SIGNATURE_BYTES));
  console.log(`\n${name} — ${megabytes(bytes.byteLength)}, detected as ${type ?? "unknown"}`);
  try {
    if (type === "pptx") await reportPptx(bytes);
    else if (type === "pdf") await reportPdf(bytes);
    else if (type === "png" || type === "jpg") await reportImage(bytes);
    else console.log("  skipped: not a supported type");
  } catch (error) {
    failures += 1;
    console.log(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\n${names.length} file(s), ${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
