import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { hasSession } from "@/lib/auth/server";
import { en } from "@/lib/i18n/en";
import { SignOut } from "@/components/sign-out";
import { Limitations } from "@/components/limitations";
import { UploadDeck } from "@/components/upload-deck";

export default async function Workspace() {
  if (!(await hasSession())) redirect("/sign-in");
  return (
    <main id="main" className="shell workspace">
      <div className="workspace-top">
        <p className="eyebrow">{en.upload.eyebrow}</p>
        <SignOut />
      </div>
      <h1>{en.upload.title}</h1>
      <p className="muted">{en.upload.privacy}</p>
      <UploadDeck />
      <div className="workspace-bottom">
        <span>
          <Check size={15} aria-hidden="true" />
          {en.workspace.status}
        </span>
        <span>{en.upload.worker}</span>
      </div>
      <Limitations />
    </main>
  );
}
