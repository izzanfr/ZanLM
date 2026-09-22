import "server-only";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { jobPathSegments, jobSchema, newJob, type Job, type JobFolder } from "./core.ts";

export function jobsRoot(): string {
  return join(process.cwd(), "data", "jobs");
}

// Paths are only ever built from jobPathSegments, which validates the id, the
// folder and the generated file name and throws on anything else.
export function jobDirectory(id: string): string {
  return join(jobsRoot(), ...jobPathSegments(id));
}

export function jobFilePath(id: string, folder: JobFolder, file: string): string {
  return join(jobsRoot(), ...jobPathSegments(id, folder, file));
}

export async function createJobFolders(id: string): Promise<void> {
  const base = jobDirectory(id);
  for (const folder of ["source", "slides", "notes"] as const) {
    await mkdir(join(base, folder), { recursive: true });
  }
}

export async function readJob(id: string): Promise<Job | null> {
  try {
    const raw = await readFile(join(jobDirectory(id), "job.json"), "utf8");
    const parsed = jobSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Written to a temporary file first so a crash cannot leave a half-written
// job.json that no longer parses.
export async function writeJob(job: Job): Promise<void> {
  const parsed = jobSchema.parse({ ...job, updatedAt: Date.now() });
  const directory = jobDirectory(parsed.id);
  const target = join(directory, "job.json");
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true });
  await writeFile(temporary, JSON.stringify(parsed, null, 2), "utf8");
  await rename(temporary, target);
}

export async function createJob(id: string, now = Date.now()): Promise<Job> {
  await createJobFolders(id);
  const job = newJob(id, now);
  await writeJob(job);
  return job;
}

export async function deleteJob(id: string): Promise<void> {
  await rm(jobDirectory(id), { recursive: true, force: true });
}
