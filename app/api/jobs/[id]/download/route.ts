import { readFile } from "node:fs/promises";
import { OUTPUT_FILE } from "@/lib/jobs/core";
import { guardJob, jsonError } from "@/lib/jobs/guard";
import { jobFilePath } from "@/lib/jobs/storage";
import { en } from "@/lib/i18n/en";

type Context = { params: Promise<{ id: string }> };

const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/**
 * The name the browser saves. The display name is the uploaded one, which is
 * content: it goes out only as an RFC 5987 encoded `filename*`, next to a
 * plain ASCII fallback, so nothing in it can break the header.
 */
export function contentDisposition(displayName: string): string {
  const base = displayName.replace(/\.pptx$/i, "");
  const pretty = `${base} (editable).pptx`;
  const ascii = pretty.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(pretty)}`;
}

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const guard = await guardJob(request, id, { mutating: false });
  if ("error" in guard) return guard.error;
  const job = guard.job;

  if (job.convert.status !== "done" || !job.convert.hasOutput) {
    return jsonError(en.jobs.noOutput, 409);
  }

  let file: Buffer;
  try {
    file = await readFile(jobFilePath(job.id, "output", OUTPUT_FILE));
  } catch {
    return jsonError(en.jobs.noOutput, 409);
  }

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": PPTX_TYPE,
      "Content-Length": String(file.length),
      "Content-Disposition": contentDisposition(job.files[0]?.name ?? "deck.pptx"),
      "Cache-Control": "no-store",
    },
  });
}
