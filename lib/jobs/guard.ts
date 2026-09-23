import "server-only";
import { NextResponse } from "next/server";
import { hasSession, sameOrigin } from "@/lib/auth/server";
import { en } from "@/lib/i18n/en";
import { isJobId } from "./core.ts";
import { readJob } from "./storage.ts";
import type { Job } from "./core.ts";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Every job route runs this itself rather than relying on proxy.ts: session
 * first, same-origin for anything that changes state, and the job id checked
 * against its pattern before any path is built from it.
 */
export async function guardJob(
  request: Request,
  rawId: string,
  options: { mutating: boolean },
): Promise<{ error: NextResponse } | { job: Job }> {
  if (!(await hasSession())) return { error: jsonError(en.errors.unauthorized, 401) };
  if (options.mutating && !sameOrigin(request)) {
    return { error: jsonError(en.errors.forbidden, 403) };
  }
  // Checked here as well as inside jobPathSegments: a bad id must be a 404,
  // not an exception from deeper in the stack.
  if (!isJobId(rawId)) return { error: jsonError(en.jobs.notFound, 404) };
  const job = await readJob(rawId);
  if (!job) return { error: jsonError(en.jobs.notFound, 404) };
  return { job };
}

export async function guardSession(
  request: Request,
  options: { mutating: boolean },
): Promise<NextResponse | null> {
  if (!(await hasSession())) return jsonError(en.errors.unauthorized, 401);
  if (options.mutating && !sameOrigin(request)) return jsonError(en.errors.forbidden, 403);
  return null;
}

/** Job state as the pages see it. Source paths never leave the server. */
/**
 * Job state as the pages see it.
 *
 * `converting` says whether this process really has the conversion in flight.
 * A job.json that says "running" while nothing is running is a job that was
 * interrupted, by a restart or a crash, and the page offers to resume it
 * rather than showing a spinner that will never stop.
 */
export function publicJob(job: Job, options: { converting?: boolean } = {}) {
  return {
    id: job.id,
    status: job.status,
    kind: job.kind,
    done: job.done,
    total: job.total,
    error: job.error,
    files: job.files.map((file) => ({ name: file.name, type: file.type, bytes: file.bytes })),
    slides: job.slides.map((slide) => ({
      index: slide.index,
      width: slide.width,
      height: slide.height,
      origin: slide.origin,
      mixed: slide.mixed,
      hidden: slide.hidden,
      notes: slide.notes,
      detection: slide.detection,
    })),
    convert: {
      status:
        job.convert.status === "running" && options.converting === false
          ? ("interrupted" as const)
          : job.convert.status,
      calls: job.convert.calls,
      hasOutput: job.convert.hasOutput,
      error: job.convert.error,
      options: job.convert.options,
    },
  };
}
