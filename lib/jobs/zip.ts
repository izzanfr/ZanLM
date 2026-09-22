import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";

export type ZipLimits = {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
};

// 500 MB of inflated output across every entry we actually read, and no single
// entry larger than 100 MB. A NotebookLM deck is a few dozen MB, so these only
// matter for an archive built to be hostile.
export const ZIP_LIMITS: ZipLimits = {
  maxEntries: 2000,
  maxTotalBytes: 500 * 1024 * 1024,
  maxEntryBytes: 100 * 1024 * 1024,
};

// A smaller budget for the pass that only reads XML parts.
export const XML_ZIP_LIMITS: ZipLimits = {
  maxEntries: 2000,
  maxTotalBytes: 64 * 1024 * 1024,
  maxEntryBytes: 8 * 1024 * 1024,
};

export type ZipFailure = "too-many-entries" | "too-large" | "corrupt";

export class ZipLimitError extends Error {
  readonly failure: ZipFailure;
  constructor(failure: ZipFailure) {
    super(`zip rejected: ${failure}`);
    this.name = "ZipLimitError";
    this.failure = failure;
  }
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Inflates only the entries `wanted` selects, and counts the inflated bytes as
 * they arrive rather than trusting the sizes declared in the archive. Going
 * over a limit throws immediately, in the middle of inflating, so a zip bomb
 * never gets to finish expanding.
 *
 * Entry names are used for matching only. Nothing here returns a path, and no
 * caller may write to one: every file this app writes is named by
 * lib/jobs/core.ts, which is what makes zip slip impossible rather than merely
 * filtered.
 */
export function readZipEntries(
  archive: Uint8Array,
  wanted: (name: string) => boolean,
  limits: ZipLimits = ZIP_LIMITS,
): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  let seen = 0;
  let total = 0;
  // fflate re-enters the data callback with its own error after a callback
  // throws, so the reason is recorded here and the first one always wins.
  let failure: ZipFailure | null = null;

  function stop(reason: ZipFailure): never {
    failure ??= reason;
    throw new ZipLimitError(failure);
  }

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.onfile = (file) => {
    seen += 1;
    if (seen > limits.maxEntries) stop("too-many-entries");
    // Entries we do not need are never inflated at all, so a bomb hidden in an
    // unused part of the archive costs nothing.
    if (!wanted(file.name)) return;

    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (failure) throw new ZipLimitError(failure);
      if (error) stop("corrupt");
      size += chunk.length;
      total += chunk.length;
      if (size > limits.maxEntryBytes || total > limits.maxTotalBytes) stop("too-large");
      chunks.push(chunk);
      if (final) entries.set(file.name, concat(chunks, size));
    };
    file.start();
  };

  try {
    unzip.push(archive, true);
  } catch (error) {
    if (failure) throw new ZipLimitError(failure);
    if (error instanceof ZipLimitError) throw error;
    throw new ZipLimitError("corrupt");
  }
  return entries;
}

export function zipEntryNames(archive: Uint8Array, limit = ZIP_LIMITS.maxEntries): string[] {
  const names: string[] = [];
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.onfile = (file) => {
    if (names.length >= limit) throw new ZipLimitError("too-many-entries");
    names.push(file.name);
  };
  try {
    unzip.push(archive, true);
  } catch (error) {
    if (error instanceof ZipLimitError) throw error;
    throw new ZipLimitError("corrupt");
  }
  return names;
}
