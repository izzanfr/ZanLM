import "server-only";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { refineBox, type RawImage } from "../box-refine.ts";
import { createBudget, measureItem, type Budget } from "../detect-run.ts";
import { cacheDirectory, createFileCache } from "../gemini/cache.ts";
import type { GeminiCall } from "../gemini/client.ts";
import { parseDetection, type Block } from "../gemini/schema.ts";
import { createServerCall, hasApiKey, serverModelChain } from "../gemini/server.ts";
import { COVER_PATCHES_DEFAULT, imageArea, layoutSlide } from "../layout.ts";
import { createMeasurer, registerFonts } from "../export/font-metrics.ts";
import { ringColor } from "../export/patch-color.ts";
import { writeSourceDeck, type SlideExport } from "../export/source-deck.ts";
import {
  decideForDeck,
  exportableBlocks,
  findMark,
  removeMark,
  toPixelRect,
  toRelative,
} from "../watermark.ts";
import {
  detectionFileName,
  slidesToDetect,
  newConvert,
  OUTPUT_FILE,
  slideFileName,
  type Convert,
  type Job,
  type Slide,
} from "./core.ts";
import { isPptxXmlPart, readPptxStructure } from "./pptx.ts";
import { jobFilePath, readJob, writeJob } from "./storage.ts";
import { readZipEntries, XML_ZIP_LIMITS } from "./zip.ts";

/** Decision 9A: a whole conversion may take twenty minutes. */
export const JOB_DEADLINE_MS = 20 * 60 * 1000;
/** Real requests one slide may cost in a single run. */
export const MAX_ATTEMPTS = 3;

// Like extraction, conversion runs inside the Next process and its cancel map
// is in memory: a restart cancels it, and the job is then resumable from disk,
// because every finished slide is already in job.json.
const running = new Map<string, AbortController>();

export function cancelConversion(id: string): boolean {
  const controller = running.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isConverting(id: string): boolean {
  return running.has(id);
}

/** A budget that also ends when the job is cancelled. */
function budgetWith(signal: AbortSignal, totalMs: number): Budget {
  const timed = createBudget(totalMs);
  const combined = AbortSignal.any([signal, timed.signal]);
  return {
    signal: combined,
    remainingMs: () => (signal.aborted ? 0 : timed.remainingMs()),
    expired: () => signal.aborted || timed.expired(),
    dispose: timed.dispose,
  };
}

function aborted(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function startConversion(id: string, options: Convert["options"]): Promise<void> {
  if (running.has(id)) return;
  const controller = new AbortController();
  running.set(id, controller);
  try {
    await runConversion(id, options, controller.signal);
  } catch (error) {
    const job = await readJob(id);
    if (job) {
      await writeJob({
        ...job,
        convert: {
          ...job.convert,
          status: aborted(error) ? "cancelled" : "failed",
          error: aborted(error) ? null : "convert-failed",
          finishedAt: Date.now(),
        },
      });
    }
  } finally {
    running.delete(id);
  }
}

type LoadedSlide = { slide: Slide; png: Uint8Array; image: RawImage };

/** Raw pixels back to a PNG, for the background picture in the export. */
function toPng(image: RawImage): Promise<Buffer> {
  const channels = image.channels === 4 ? 4 : 3;
  return sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels },
  })
    .png()
    .toBuffer();
}

async function loadSlides(job: Job): Promise<LoadedSlide[]> {
  const loaded: LoadedSlide[] = [];
  for (const slide of job.slides) {
    const png = new Uint8Array(
      await readFile(jobFilePath(job.id, "slides", slideFileName(slide.index))),
    );
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    loaded.push({
      slide,
      png,
      image: { data, width: info.width, height: info.height, channels: info.channels },
    });
  }
  return loaded;
}

/**
 * Detects what still needs detecting and then writes the deck.
 *
 * Resume is the whole shape of this function: a slide whose detection is
 * already done is never sent again, a failed one is only sent again when
 * sending it could help, and every finished slide is written to job.json as it
 * lands, so a restart in the middle costs only what was in flight.
 */
async function runConversion(
  id: string,
  options: Convert["options"],
  signal: AbortSignal,
): Promise<void> {
  let job = await readJob(id);
  if (!job) throw new Error("unknown job");
  if (job.status !== "done" || job.slides.length === 0) throw new Error("nothing to convert");

  job = {
    ...job,
    convert: {
      ...newConvert(),
      calls: job.convert.calls,
      status: "running",
      options,
      startedAt: Date.now(),
    },
  };
  await writeJob(job);

  const slides = await loadSlides(job);
  const budget = budgetWith(signal, JOB_DEADLINE_MS);
  try {
    if (serverModelChain().length > 0) {
      job = await detectSlides(job, slides, budget, signal);
    } else {
      // Without a model there is nothing to detect; the deck is still
      // exported, which is the same outcome as every slide failing (7A).
      job = { ...job, convert: { ...job.convert, error: "no-model-configured" } };
      await writeJob(job);
    }
    if (signal.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    job = await exportDeck(job, slides, options);
  } finally {
    budget.dispose();
  }
}

async function detectSlides(
  start: Job,
  slides: readonly LoadedSlide[],
  budget: Budget,
  signal: AbortSignal,
): Promise<Job> {
  let job = start;
  const chain = serverModelChain();
  // Without a key every request fails, but a cached answer still costs
  // nothing, so a deck that was converted before converts again offline.
  const call: GeminiCall = hasApiKey()
    ? createServerCall()
    : () => Promise.reject(new Error("no api key"));
  const directory = cacheDirectory(process.env, process.cwd());
  const cache = directory ? createFileCache(directory) : null;

  const wanted = new Set(slidesToDetect(job.slides));
  for (const { slide, png } of slides) {
    if (signal.aborted) break;
    if (slide.mixed) {
      job = await recordDetection(job, slide.index, {
        status: "skipped",
        reason: "mixed",
        blocks: 0,
        fromCache: false,
        model: null,
      });
      continue;
    }
    if (!wanted.has(slide.index)) continue;
    if (budget.expired()) break;

    const outcome = await measureItem({
      png,
      chain,
      mediaResolution: "default",
      call,
      cache,
      maxAttempts: MAX_ATTEMPTS,
      budget,
    });
    job = {
      ...job,
      convert: { ...job.convert, calls: job.convert.calls + outcome.requests },
    };

    if (!outcome.ok) {
      job = await recordDetection(job, slide.index, {
        status: "failed",
        reason: outcome.status,
        blocks: 0,
        fromCache: false,
        model: null,
      });
      continue;
    }
    const { detection, model, fromCache } = outcome.result;
    await writeFile(
      jobFilePath(job.id, "detect", detectionFileName(slide.index)),
      JSON.stringify({ model, blocks: detection.blocks }, null, 2),
      "utf8",
    );
    job = await recordDetection(job, slide.index, {
      status: "done",
      reason: null,
      blocks: detection.blocks.length,
      fromCache,
      model,
    });
  }
  return job;
}

async function recordDetection(
  job: Job,
  index: number,
  detection: NonNullable<Slide["detection"]>,
): Promise<Job> {
  const next: Job = {
    ...job,
    slides: job.slides.map((slide) => (slide.index === index ? { ...slide, detection } : slide)),
  };
  await writeJob(next);
  return next;
}

/** The blocks of one slide as they were stored, or null when there are none. */
async function storedBlocks(job: Job, index: number): Promise<Block[] | null> {
  try {
    const raw = await readFile(jobFilePath(job.id, "detect", detectionFileName(index)), "utf8");
    const parsed = parseDetection(JSON.stringify({ blocks: JSON.parse(raw).blocks }));
    return parsed.ok ? parsed.detection.blocks : null;
  } catch {
    return null;
  }
}

async function exportDeck(
  start: Job,
  slides: readonly LoadedSlide[],
  options: Convert["options"],
): Promise<Job> {
  let job = start;
  if (job.kind !== "pptx") {
    // The pptxgenjs writer for PDF and image jobs is not written yet.
    job = {
      ...job,
      convert: {
        ...job.convert,
        status: "failed",
        error: "export-kind-unsupported",
        finishedAt: Date.now(),
      },
    };
    await writeJob(job);
    return job;
  }

  const source = job.files[0];
  const original = new Uint8Array(await readFile(jobFilePath(job.id, "source", source.file)));
  const deck = readPptxStructure(readZipEntries(original, isPptxXmlPart, XML_ZIP_LIMITS));
  const slideSize = { widthEmu: deck.widthEmu, heightEmu: deck.heightEmu };

  const decision = decideForDeck(
    slides.map(({ image }) => {
      const rect = findMark(image);
      return rect ? toRelative(rect, image) : null;
    }),
  );
  const clean = options.removeWatermark && decision.remove;

  registerFonts();
  const measure = createMeasurer();
  const exports: SlideExport[] = [];

  for (const [position, entry] of slides.entries()) {
    let image = entry.image;
    let picture: Uint8Array | undefined;
    if (clean && decision.slides[position]) {
      const letters = findMark(image);
      if (letters) {
        const result = removeMark(image, letters, toPixelRect(decision.area!, image));
        image = result.image;
        picture = new Uint8Array(await toPng(image));
      }
    }

    const stored = entry.slide.mixed ? null : await storedBlocks(job, entry.slide.index);
    if (!stored && !picture) continue;

    const blocks = (stored ?? [])
      .filter(() => !entry.slide.mixed)
      .map((block) => {
        const refined = refineBox(image, block.box_2d, block.color).box;
        return { ...block, box_2d: [...refined] as Block["box_2d"] };
      });
    const exportable = exportableBlocks(blocks, {
      removeWatermark: clean || options.dropWatermarks,
    });

    const { area } = imageArea(image, slideSize);
    const layout = layoutSlide(exportable, area, slideSize, measure, {
      coverPatches: options.coverPatches ?? COVER_PATCHES_DEFAULT,
    });
    const patchColors = options.coverPatches
      ? layout.blocks.map((laid) => {
          const [ymin, xmin, ymax, xmax] = laid.block.box_2d;
          const scale = (value: number, size: number) => Math.round((value / 1000) * size);
          return ringColor(image, {
            x0: scale(Math.min(xmin, xmax), image.width),
            y0: scale(Math.min(ymin, ymax), image.height),
            x1: scale(Math.max(xmin, xmax), image.width),
            y1: scale(Math.max(ymin, ymax), image.height),
          }).color;
        })
      : undefined;

    exports.push({ index: entry.slide.index, layout, picture, patchColors });
  }

  const result = writeSourceDeck(original, deck, exports);
  await writeFile(jobFilePath(job.id, "output", OUTPUT_FILE), result.archive);

  job = {
    ...job,
    convert: {
      ...job.convert,
      status: "done",
      hasOutput: true,
      finishedAt: Date.now(),
    },
  };
  await writeJob(job);
  return job;
}
