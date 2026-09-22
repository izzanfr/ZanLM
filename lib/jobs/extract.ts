import "server-only";
import { readFile, writeFile } from "node:fs/promises";
import {
  compareNatural,
  limitsFromEnv,
  notesFileName,
  slideFileName,
  type Job,
  type Slide,
} from "./core.ts";
import { normalizeToPng, type NormalizedImage } from "./images.ts";
import { extractPdf } from "./pdf.ts";
import { isPptxXmlPart, pictureEntries, readPptxStructure } from "./pptx.ts";
import { jobFilePath, readJob, writeJob } from "./storage.ts";
import { readZipEntries, XML_ZIP_LIMITS } from "./zip.ts";

// Extraction runs inside the Next process, so a cancel request only has to
// reach this map. It is deliberately in memory: a restart cancels everything,
// which is the correct outcome for a local tool with no queue.
const running = new Map<string, AbortController>();

export function cancelExtraction(id: string): boolean {
  const controller = running.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isExtracting(id: string): boolean {
  return running.has(id);
}

function aborted(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** A short code for job.json. Never an exception message, which could echo content. */
function failureCode(error: unknown): string {
  if (error instanceof Error && "reason" in error && typeof error.reason === "string") {
    return `${error.name}: ${error.reason}`;
  }
  return "extraction-failed";
}

export async function startExtraction(id: string): Promise<void> {
  if (running.has(id)) return;
  const controller = new AbortController();
  running.set(id, controller);
  try {
    await runExtraction(id, controller.signal);
  } catch (error) {
    const job = await readJob(id);
    if (job) {
      await writeJob({
        ...job,
        status: aborted(error) ? "cancelled" : "failed",
        error: aborted(error) ? null : failureCode(error),
      });
    }
  } finally {
    running.delete(id);
  }
}

async function runExtraction(id: string, signal: AbortSignal): Promise<void> {
  const job = await readJob(id);
  if (!job) throw new Error("unknown job");
  const limits = limitsFromEnv(process.env);

  await writeJob({ ...job, status: "extracting", done: 0, total: 0, slides: [], error: null });

  const slides =
    job.kind === "pptx"
      ? await extractPptxJob(job, signal)
      : job.kind === "pdf"
        ? await extractPdfJob(job, limits.maxSlides, signal)
        : await extractImageJob(job, signal);

  if (slides.length > limits.maxSlides) throw new Error("too-many-slides");

  const finished = await readJob(id);
  if (!finished) throw new Error("unknown job");
  await writeJob({
    ...finished,
    status: "done",
    slides,
    done: slides.length,
    total: slides.length,
    error: null,
  });
}

/** Reports progress without letting a slow write block the next slide. */
async function reportProgress(id: string, done: number, total: number): Promise<void> {
  const job = await readJob(id);
  if (!job || job.status !== "extracting") return;
  await writeJob({ ...job, done, total });
}

async function writeSlide(
  id: string,
  index: number,
  image: NormalizedImage,
  notes: string | null,
): Promise<void> {
  await writeFile(jobFilePath(id, "slides", slideFileName(index)), image.data);
  if (notes !== null) {
    await writeFile(jobFilePath(id, "notes", notesFileName(index)), notes, "utf8");
  }
}

async function extractPptxJob(job: Job, signal: AbortSignal): Promise<Slide[]> {
  const source = job.files[0];
  if (!source) throw new Error("no source file");
  const archive = new Uint8Array(await readFile(jobFilePath(job.id, "source", source.file)));

  // Pass one reads only the XML parts, under a small budget. Pass two inflates
  // just the pictures the deck actually uses, so no unused entry is ever
  // expanded and a bomb hidden in one costs nothing.
  const deck = readPptxStructure(readZipEntries(archive, isPptxXmlPart, XML_ZIP_LIMITS));
  const wanted = pictureEntries(deck);
  const media = wanted.size > 0 ? readZipEntries(archive, (name) => wanted.has(name)) : new Map();

  const slides: Slide[] = [];
  let index = 0;
  for (const slide of deck.slides) {
    signal.throwIfAborted();
    const bytes = slide.picture ? media.get(slide.picture) : undefined;
    if (!bytes) {
      // A slide with no usable picture is reported rather than silently
      // renumbering the deck around it.
      continue;
    }
    index += 1;
    const image = await normalizeToPng(bytes);
    await writeSlide(job.id, index, image, slide.notes);
    slides.push({
      index,
      file: slideFileName(index),
      width: image.width,
      height: image.height,
      origin: "pptx-picture",
      mixed: slide.mixed,
      hidden: slide.hidden,
      notes: slide.notes !== null,
    });
    await reportProgress(job.id, index, deck.slides.length);
  }
  return slides;
}

async function extractPdfJob(job: Job, maxPages: number, signal: AbortSignal): Promise<Slide[]> {
  const source = job.files[0];
  if (!source) throw new Error("no source file");
  const data = new Uint8Array(await readFile(jobFilePath(job.id, "source", source.file)));

  const pages = await extractPdf(data, {
    maxPages,
    signal,
    onPage: (index, total) => {
      void reportProgress(job.id, index, total);
    },
  });

  const slides: Slide[] = [];
  for (const page of pages) {
    signal.throwIfAborted();
    await writeSlide(job.id, page.index, page.image, null);
    slides.push({
      index: page.index,
      file: slideFileName(page.index),
      width: page.image.width,
      height: page.image.height,
      origin: page.origin,
      mixed: page.mixed,
      hidden: false,
      notes: false,
    });
  }
  return slides;
}

async function extractImageJob(job: Job, signal: AbortSignal): Promise<Slide[]> {
  // Decision 3: natural order of the names the person gave the files, so
  // "slide-2" comes before "slide-10". Dragging to reorder arrives in T7.
  const ordered = [...job.files].sort((a, b) => compareNatural(a.name, b.name));
  const slides: Slide[] = [];
  let index = 0;
  for (const file of ordered) {
    signal.throwIfAborted();
    index += 1;
    const bytes = new Uint8Array(await readFile(jobFilePath(job.id, "source", file.file)));
    const image = await normalizeToPng(bytes);
    await writeSlide(job.id, index, image, null);
    slides.push({
      index,
      file: slideFileName(index),
      width: image.width,
      height: image.height,
      origin: "image",
      mixed: false,
      hidden: false,
      notes: false,
    });
    await reportProgress(job.id, index, ordered.length);
  }
  return slides;
}
