import { canTransition, limitsFromEnv, planJobKind } from "@/lib/jobs/core";
import { guardJob, json, jsonError, publicJob } from "@/lib/jobs/guard";
import { startExtraction } from "@/lib/jobs/extract";
import { writeJob } from "@/lib/jobs/storage";
import { en } from "@/lib/i18n/en";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const guard = await guardJob(request, id, { mutating: true });
  if ("error" in guard) return guard.error;
  const job = guard.job;

  if (job.files.length === 0) return jsonError(en.jobs.noFiles, 409);
  if (!canTransition(job.status, "ready") && job.status !== "ready") {
    return jsonError(en.jobs.wrongState, 409);
  }

  const mix = planJobKind(
    job.files.map((file) => file.type),
    limitsFromEnv(process.env),
  );
  if (!mix.ok) return jsonError(en.jobs.mixedTypes, 409);

  const ready = { ...job, status: "ready" as const, kind: mix.kind, error: null };
  await writeJob(ready);

  // Extraction runs in the background; the page polls GET /api/jobs/[id].
  // Failures are recorded in job.json rather than thrown at this response.
  void startExtraction(job.id);

  return json(publicJob({ ...ready, status: "extracting" }), 202);
}
