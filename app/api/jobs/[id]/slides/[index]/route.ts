import { readFile } from "node:fs/promises";
import { slideFileName } from "@/lib/jobs/core";
import { guardJob, jsonError } from "@/lib/jobs/guard";
import { jobFilePath } from "@/lib/jobs/storage";
import { en } from "@/lib/i18n/en";

type Context = { params: Promise<{ id: string; index: string }> };

export async function GET(request: Request, context: Context) {
  const { id, index } = await context.params;
  const guard = await guardJob(request, id, { mutating: false });
  if ("error" in guard) return guard.error;

  // The index has to name a slide this job really has, so the file name is
  // built from a number we already trust rather than from the URL text.
  if (!/^\d{1,4}$/.test(index)) return jsonError(en.jobs.slideNotFound, 404);
  const slide = guard.job.slides.find((entry) => entry.index === Number(index));
  if (!slide) return jsonError(en.jobs.slideNotFound, 404);

  try {
    const bytes = await readFile(jobFilePath(guard.job.id, "slides", slideFileName(slide.index)));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.byteLength),
        // Job folders are disposable and slides can be re-extracted, so a
        // cached copy would outlive what it shows.
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${slideFileName(slide.index)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return jsonError(en.jobs.slideNotFound, 404);
  }
}
