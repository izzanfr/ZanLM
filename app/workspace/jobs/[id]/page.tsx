import { notFound, redirect } from "next/navigation";
import { Check } from "lucide-react";
import { hasSession } from "@/lib/auth/server";
import { en } from "@/lib/i18n/en";
import { isJobId } from "@/lib/jobs/core";
import { publicJob } from "@/lib/jobs/guard";
import { readJob } from "@/lib/jobs/storage";
import { SignOut } from "@/components/sign-out";
import { JobProgress, type PublicJob } from "@/components/job-progress";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) redirect("/sign-in");
  const { id } = await params;
  // Checked before anything touches the file system, exactly as the API does.
  if (!isJobId(id)) notFound();
  const job = await readJob(id);
  if (!job) notFound();

  return (
    <main id="main" className="shell workspace">
      <div className="workspace-top">
        <p className="eyebrow">{en.processing.eyebrow}</p>
        <SignOut />
      </div>
      <h1>{en.processing.title}</h1>
      <JobProgress initial={publicJob(job) as PublicJob} />
      <div className="workspace-bottom">
        <span>
          <Check size={15} aria-hidden="true" />
          {en.workspace.status}
        </span>
        <span>{en.processing.worker}</span>
      </div>
    </main>
  );
}
