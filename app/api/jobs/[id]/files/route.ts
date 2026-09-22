import { open, unlink } from "node:fs/promises";
import {
  canTransition,
  detectType,
  limitsFromEnv,
  planJobKind,
  sanitizeDisplayName,
  SIGNATURE_BYTES,
  storedFileName,
  type SourceType,
} from "@/lib/jobs/core";
import { guardJob, json, jsonError, publicJob } from "@/lib/jobs/guard";
import { jobFilePath, writeJob } from "@/lib/jobs/storage";
import { en } from "@/lib/i18n/en";

type Context = { params: Promise<{ id: string }> };

const MIX_MESSAGES = {
  empty: en.jobs.noFiles,
  "mixed-types": en.jobs.mixedTypes,
  "too-many-files": en.jobs.tooManyFiles,
  "too-many-images": en.jobs.tooManyImages,
} as const;

/** The browser sends the name percent-encoded, because headers are latin1. */
function decodeName(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Reads and discards the rest of a rejected upload, up to a bounded amount. */
async function drain(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  budget: number,
): Promise<void> {
  let dropped = 0;
  try {
    while (dropped < budget) {
      const { done, value } = await reader.read();
      if (done) return;
      dropped += value.byteLength;
    }
  } catch {
    // The client gave up first, which is fine.
  }
  await reader.cancel().catch(() => {});
}

export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  const guard = await guardJob(request, id, { mutating: true });
  if ("error" in guard) return guard.error;
  const job = guard.job;

  if (!canTransition(job.status, "uploading")) return jsonError(en.jobs.wrongState, 409);

  const displayName = decodeName(request.headers.get("x-file-name"));
  if (!displayName) return jsonError(en.jobs.missingName, 400);

  const reader = request.body?.getReader();
  if (!reader) return jsonError(en.errors.invalidRequest, 400);

  const limits = limitsFromEnv(process.env);
  const head: number[] = [];
  const pending: Uint8Array[] = [];
  let type: SourceType | null = null;
  let stored: string | null = null;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let size = 0;

  const cleanup = async () => {
    await handle?.close();
    if (stored) await unlink(jobFilePath(job.id, "source", stored)).catch(() => {});
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      // The cap is enforced against the bytes actually arriving, not against a
      // Content-Length the client could leave out or lie about.
      if (size > limits.maxUploadBytes) {
        await cleanup();
        stored = null;
        // Nothing more is written or kept, but the rest of the upload is read
        // and dropped so the 413 reaches the browser instead of the connection
        // being reset mid-send. A client that keeps streaming past twice the
        // cap is cut off anyway.
        await drain(reader, limits.maxUploadBytes);
        return jsonError(en.jobs.tooLarge, 413);
      }

      if (type === null) {
        for (const byte of value) {
          if (head.length < SIGNATURE_BYTES) head.push(byte);
        }
        pending.push(value);
        if (head.length < SIGNATURE_BYTES) continue;

        type = detectType(new Uint8Array(head));
        if (type === null) {
          await drain(reader, limits.maxUploadBytes);
          return jsonError(en.jobs.unsupported, 415);
        }

        // The mix rule is checked before a single byte is written, so a file
        // that cannot belong to this job never reaches the disk.
        const mix = planJobKind([...job.files.map((file) => file.type), type], limits);
        if (!mix.ok) {
          await drain(reader, limits.maxUploadBytes);
          return jsonError(MIX_MESSAGES[mix.reason], 409);
        }

        // The name on disk is generated here. The uploaded name is only ever
        // stored as text for display.
        stored = storedFileName(job.files.length + 1, type);
        handle = await open(jobFilePath(job.id, "source", stored), "w");
        for (const chunk of pending) await handle.write(chunk);
        pending.length = 0;
        continue;
      }

      await handle!.write(value);
    }

    if (type === null || stored === null || handle === null) {
      await cleanup();
      return jsonError(en.jobs.unsupported, 415);
    }
    await handle.close();
    handle = null;

    const files = [
      ...job.files,
      { file: stored, name: sanitizeDisplayName(displayName), type, bytes: size },
    ];
    const mix = planJobKind(
      files.map((file) => file.type),
      limits,
    );
    const updated = {
      ...job,
      status: "uploading" as const,
      kind: mix.ok ? mix.kind : null,
      files,
    };
    await writeJob(updated);
    return json(publicJob(updated), 201);
  } catch {
    await cleanup();
    return jsonError(en.errors.generic, 500);
  }
}
