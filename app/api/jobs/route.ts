import { createJobId } from "@/lib/jobs/core";
import { guardSession, json, publicJob } from "@/lib/jobs/guard";
import { createJob } from "@/lib/jobs/storage";

export async function POST(request: Request) {
  const denied = await guardSession(request, { mutating: true });
  if (denied) return denied;
  // The id is generated here and only here. A request never supplies one.
  const job = await createJob(createJobId());
  return json(publicJob(job), 201);
}
