import { guardJob, json, jsonError } from "@/lib/jobs/guard";
import { cancelConversion, isConverting } from "@/lib/jobs/convert";
import { cancelExtraction } from "@/lib/jobs/extract";
import { deleteJob } from "@/lib/jobs/storage";
import { publicJob } from "@/lib/jobs/guard";
import { en } from "@/lib/i18n/en";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const guard = await guardJob(request, id, { mutating: false });
  if ("error" in guard) return guard.error;
  return json(publicJob(guard.job, { converting: isConverting(guard.job.id) }));
}

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  const guard = await guardJob(request, id, { mutating: true });
  if ("error" in guard) return guard.error;
  // Stop the work before the folder it writes into disappears.
  cancelExtraction(guard.job.id);
  cancelConversion(guard.job.id);
  try {
    await deleteJob(guard.job.id);
  } catch {
    return jsonError(en.errors.generic, 500);
  }
  return json({ ok: true });
}
