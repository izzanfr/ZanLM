"use client";
import { useRouter } from "next/navigation";
import { useCallback, useId, useRef, useState } from "react";
import { FileStack, Trash2, Upload } from "lucide-react";
import { en } from "@/lib/i18n/en";

type Pending = {
  key: string;
  file: File;
  status: "waiting" | "uploading" | "done" | "failed";
  error: string | null;
};

const ACCEPT = ".pptx,.pdf,.png,.jpg,.jpeg";

let counter = 0;

function describe(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadDeck() {
  const router = useRouter();
  const [files, setFiles] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const add = useCallback((incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;
    setError(null);
    setFiles((current) => [
      ...current,
      ...Array.from(incoming).map((file) => {
        counter += 1;
        return { key: `${counter}`, file, status: "waiting" as const, error: null };
      }),
    ]);
  }, []);

  function remove(key: string) {
    setFiles((current) => current.filter((entry) => entry.key !== key));
  }

  async function start() {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await fetch("/api/jobs", { method: "POST" });
      if (!created.ok) throw new Error(await messageOf(created));
      const job = await created.json();

      for (const entry of files) {
        setFiles((current) =>
          current.map((item) => (item.key === entry.key ? { ...item, status: "uploading" } : item)),
        );
        const response = await fetch(`/api/jobs/${job.id}/files`, {
          method: "PUT",
          // Headers are latin1, so a name with accents has to be encoded.
          headers: { "X-File-Name": encodeURIComponent(entry.file.name) },
          body: entry.file,
        });
        if (!response.ok) {
          const reason = await messageOf(response);
          setFiles((current) =>
            current.map((item) =>
              item.key === entry.key ? { ...item, status: "failed", error: reason } : item,
            ),
          );
          setError(reason);
          setBusy(false);
          return;
        }
        setFiles((current) =>
          current.map((item) => (item.key === entry.key ? { ...item, status: "done" } : item)),
        );
      }

      const started = await fetch(`/api/jobs/${job.id}/start`, { method: "POST" });
      if (!started.ok) throw new Error(await messageOf(started));
      router.push(`/workspace/jobs/${job.id}`);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : en.errors.generic);
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div
        // The drop zone is a convenience; the button below is the real control,
        // so there is no keyboard trap and nothing depends on dragging.
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          add(event.dataTransfer.files);
        }}
        className={`flex flex-col items-center gap-3 rounded-card border border-dashed p-12 text-center transition-colors duration-(--motion-feedback) ease-standard ${
          dragging ? "border-focus bg-surface" : "border-border bg-canvas"
        }`}
      >
        <Upload size={28} strokeWidth={1.3} aria-hidden="true" className="text-muted" />
        <p className="text-h2">{dragging ? en.upload.dropActive : en.upload.drop}</p>
        <p className="text-caption text-muted">{en.upload.formats}</p>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          onChange={(event) => {
            add(event.target.files);
            event.target.value = "";
          }}
        />
        <button type="button" className="button" onClick={() => input.current?.click()}>
          {en.upload.browse}
        </button>
        <p className="text-caption text-muted">{en.upload.browseHint}</p>
      </div>

      <div aria-labelledby={listId} className="flex flex-col gap-3">
        <h2 id={listId} className="text-label text-muted">
          {en.upload.fileList}
        </h2>
        {files.length === 0 ? (
          <p className="text-body text-muted">{en.upload.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {files.map((entry) => (
              <li
                key={entry.key}
                className="flex items-center gap-3 rounded-control border border-border bg-surface px-4 py-3"
              >
                <FileStack size={18} strokeWidth={1.4} aria-hidden="true" className="text-muted" />
                <span className="min-w-0 flex-1 truncate text-body">{entry.file.name}</span>
                <span className="text-caption text-muted">{describe(entry.file.size)}</span>
                {entry.status === "uploading" ? (
                  <span className="text-caption text-muted">{en.upload.uploading}</span>
                ) : null}
                {entry.status === "failed" ? (
                  <span className="text-caption text-error">{en.upload.failed}</span>
                ) : null}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={en.upload.removeFile(entry.file.name)}
                  onClick={() => remove(entry.key)}
                  disabled={busy}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-body text-error">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="button"
          onClick={start}
          disabled={files.length === 0 || busy}
        >
          {busy ? en.upload.starting : en.upload.start}
        </button>
        {files.length > 0 && !busy ? (
          <button
            type="button"
            className="rounded-control text-label text-muted underline underline-offset-4 hover:text-ink focus-visible:ring-2 focus-visible:ring-focus"
            onClick={() => setFiles([])}
          >
            {en.upload.clear}
          </button>
        ) : null}
      </div>
    </section>
  );
}

async function messageOf(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return typeof body?.error === "string" ? body.error : en.errors.generic;
  } catch {
    return en.errors.generic;
  }
}
