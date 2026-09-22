import { canTransition } from "@/lib/jobs/core";
import { cancelExtraction } from "@/lib/jobs/extract";
import { guardJob, json, jsonError, publicJob } from "@/lib/jobs/guard";
import { writeJob } from "@/lib/jobs/storage";
import { en } from "@/lib/i18n/en";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const guard = await guardJob(request, id, { mutating: true });
  if ("error" in guard) return guard.error;
  const job = guard.job;

  if (!canTransition(job.status, "cancelled")) return jsonError(en.jobs.wrongState, 409);

  // If work is in flight, its own abort path writes the final state. If not,
  // the job is marked cancelled here so a job that never started can be closed.
  if (!cancelExtraction(job.id)) {
    await writeJob({ ...job, status: "cancelled", error: null });
    return json(publicJob({ ...job, status: "cancelled" }));
  }
  return json(publicJob(job), 202);
}
