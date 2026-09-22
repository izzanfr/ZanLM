import Link from "next/link";
import { redirect } from "next/navigation";
import { FileStack, Check, ArrowUpRight } from "lucide-react";
import { hasSession } from "@/lib/auth/server";
import { en } from "@/lib/i18n/en";
import { SignOut } from "@/components/sign-out";
import { Limitations } from "@/components/limitations";
export default async function Workspace() {
  if (!(await hasSession())) redirect("/sign-in");
  return (
    <main id="main" className="shell workspace">
      <div className="workspace-top">
        <p className="eyebrow">{en.workspace.eyebrow}</p>
        <SignOut />
      </div>
      <h1>{en.workspace.title}</h1>
      <p className="muted">{en.workspace.description}</p>
      <section className="workspace-empty">
        <div className="empty-icon">
          <FileStack size={36} strokeWidth={1.3} aria-hidden="true" />
        </div>
        <span className="sample-badge">{en.workspace.badge}</span>
        <h2>{en.workspace.next}</h2>
        <p>{en.workspace.body}</p>
        <span className="formats">{en.workspace.formats}</span>
        <Link className="button" href="/#demo">
          {en.workspace.back}
          <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      </section>
      <div className="workspace-bottom">
        <span>
          <Check size={15} aria-hidden="true" />
          {en.workspace.status}
        </span>
        <span>{en.workspace.noUpload}</span>
      </div>
      <Limitations />
    </main>
  );
}
