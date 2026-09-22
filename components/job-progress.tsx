"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { en } from "@/lib/i18n/en";

type PublicSlide = {
  index: number;
  width: number;
  height: number;
  origin: string;
  mixed: boolean;
  hidden: boolean;
  notes: boolean;
};

export type PublicJob = {
  id: string;
  status: "created" | "uploading" | "ready" | "extracting" | "done" | "failed" | "cancelled";
  kind: "pptx" | "pdf" | "images" | null;
  done: number;
  total: number;
  error: string | null;
  slides: PublicSlide[];
};

const SETTLED = new Set(["done", "failed", "cancelled"]);

export function JobProgress({ initial }: { initial: PublicJob }) {
  const [job, setJob] = useState(initial);
  const [cancelling, setCancelling] = useState(false);
  const settled = SETTLED.has(job.status);

  useEffect(() => {
    // Polling is decided from the state the server rendered. Once a poll comes
    // back settled the interval clears itself, so this never restarts.
    if (SETTLED.has(initial.status)) return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/jobs/${initial.id}`, { cache: "no-store" });
        if (!response.ok || !active) return;
        const next = (await response.json()) as PublicJob;
        if (!active) return;
        setJob(next);
        if (SETTLED.has(next.status)) clearInterval(timer);
      } catch {
        // A single failed poll is not worth showing; the next one retries.
      }
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [initial.id, initial.status]);

  async function cancel() {
    setCancelling(true);
    try {
      await fetch(`/api/jobs/${job.id}/cancel`, { method: "POST" });
    } catch {
      setCancelling(false);
    }
  }

  const total = job.total || job.slides.length;
  const done = Math.min(job.done, total || job.done);

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p
          // Announced as it changes so progress is not visual only.
          role="status"
          aria-live="polite"
          aria-label={en.processing.liveRegion}
          className="text-h2"
        >
          {settled
            ? statusHeading(job)
            : total > 0
              ? en.processing.progress(done, total)
              : en.processing.preparing}
        </p>
        <p className="text-caption text-muted">{en.processing.stages}</p>
        <p className="text-caption text-muted">
          {en.processing.stageLive} · {en.processing.stageLater} · {en.processing.noQuota}
        </p>
      </div>

      {job.status === "failed" ? (
        <p role="alert" className="text-body text-error">
          {en.processing.failedTitle} {job.error ? `(${job.error})` : ""}
        </p>
      ) : null}

      {job.slides.length > 0 ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {job.slides.map((slide) => (
            <li
              key={slide.index}
              className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3"
            >
              {/* A plain img: these are job files served with no-store, not
                  static assets the image optimizer should touch. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/jobs/${job.id}/slides/${slide.index}`}
                alt={en.processing.slide(slide.index)}
                width={slide.width}
                height={slide.height}
                className="h-auto w-full rounded-control border border-border bg-canvas"
              />
              <span className="text-label">{en.processing.slide(slide.index)}</span>
              <span className="text-caption text-muted">
                {slide.width} × {slide.height}
              </span>
              {slide.mixed ? (
                <span className="text-caption text-warning">{en.processing.mixed}</span>
              ) : null}
              {slide.hidden ? (
                <span className="text-caption text-muted">{en.processing.hidden}</span>
              ) : null}
              {slide.notes ? (
                <span className="text-caption text-muted">{en.processing.hasNotes}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        {settled ? (
          <Link className="button" href="/workspace">
            {en.processing.newDeck}
          </Link>
        ) : (
          <button type="button" className="button" onClick={cancel} disabled={cancelling}>
            {cancelling ? en.processing.cancelling : en.processing.cancel}
          </button>
        )}
      </div>

      {job.status === "done" ? <p className="text-body muted">{en.processing.doneBody}</p> : null}
      {job.status === "cancelled" ? (
        <p className="text-body muted">{en.processing.cancelledBody}</p>
      ) : null}
    </section>
  );
}

function statusHeading(job: PublicJob): string {
  if (job.status === "done") return en.processing.done;
  if (job.status === "cancelled") return en.processing.cancelled;
  return en.processing.failedTitle;
}
