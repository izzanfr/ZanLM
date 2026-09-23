import { z } from "zod";
import { isConverting, startConversion } from "@/lib/jobs/convert";
import { guardJob, json, jsonError, publicJob } from "@/lib/jobs/guard";
import { en } from "@/lib/i18n/en";

type Context = { params: Promise<{ id: string }> };

/** The three checkboxes of the Convert screen, and nothing else. */
const optionsSchema = z
  .object({
    coverPatches: z.boolean().default(false),
    dropWatermarks: z.boolean().default(true),
    removeWatermark: z.boolean().default(true),
  })
  .strict();

/** Small enough that a body cannot be used to fill memory. */
const MAX_BODY_BYTES = 1024;

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const guard = await guardJob(request, id, { mutating: true });
  if ("error" in guard) return guard.error;
  const job = guard.job;

  if (job.status !== "done" || job.slides.length === 0) {
    return jsonError(en.jobs.wrongState, 409);
  }
  let options = { coverPatches: false, dropWatermarks: true, removeWatermark: true };
  const body = await request.text();
  if (body.trim().length > 0) {
    if (body.length > MAX_BODY_BYTES) return jsonError(en.errors.tooLarge, 413);
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      return jsonError(en.errors.invalidRequest, 400);
    }
    const parsed = optionsSchema.safeParse(raw);
    if (!parsed.success) return jsonError(en.errors.invalidRequest, 400);
    options = parsed.data;
  }

  // One conversion at a time per job, so two clicks cannot detect twice. The
  // body is checked first, so a malformed request is still a 400. A job.json
  // that says "running" while nothing is in flight was interrupted, and
  // starting it again is exactly how it resumes.
  if (isConverting(job.id)) return json(publicJob(job, { converting: true }), 202);

  // The conversion runs in the background; the page polls GET /api/jobs/[id].
  // Failures are recorded in job.json rather than thrown at this response.
  void startConversion(job.id, options);

  return json(publicJob(job), 202);
}
