"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { en } from "@/lib/i18n/en";

type PublicDetection = {
  status: "done" | "failed" | "skipped";
  reason: string | null;
  blocks: number;
  fromCache: boolean;
  model: string | null;
};

type PublicSlide = {
  index: number;
  width: number;
  height: number;
  origin: string;
  mixed: boolean;
  hidden: boolean;
  notes: boolean;
  detection: PublicDetection | null;
};

type PublicConvert = {
  status: "idle" | "running" | "interrupted" | "done" | "failed" | "cancelled";
  calls: number;
  hasOutput: boolean;
  error: string | null;
  options: { coverPatches: boolean; dropWatermarks: boolean; removeWatermark: boolean };
};

export type PublicJob = {
  id: string;
  status: "created" | "uploading" | "ready" | "extracting" | "done" | "failed" | "cancelled";
  kind: "pptx" | "pdf" | "images" | null;
  done: number;
  total: number;
  error: string | null;
  slides: PublicSlide[];
  convert: PublicConvert;
};

const SETTLED = new Set(["done", "failed", "cancelled"]);

export function JobProgress({ initial }: { initial: PublicJob }) {
  const [job, setJob] = useState(initial);
  const [cancelling, setCancelling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [options, setOptions] = useState(initial.convert.options);
  const settled = SETTLED.has(job.status);
  const converting = job.convert.status === "running" || starting;

  useEffect(() => {
    // Polling runs while anything is in flight: extraction, or a conversion
    // that is still going after extraction settled. It stops itself when both
    // are finished, so it never spins on a deck that is done.
    let active = true;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/jobs/${initial.id}`, { cache: "no-store" });
        if (!response.ok || !active) return;
        const next = (await response.json()) as PublicJob;
        if (!active) return;
        setJob(next);
        setStarting(false);
        if (SETTLED.has(next.status) && next.convert.status !== "running") clearInterval(timer);
      } catch {
        // A single failed poll is not worth showing; the next one retries.
      }
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [initial.id]);

  async function convert() {
    setStarting(true);
    try {
      await fetch(`/api/jobs/${job.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      });
    } catch {
      setStarting(false);
    }
  }

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
              <DetectionLine
                detection={slide.detection}
                converting={job.convert.status === "running"}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {job.status === "done" ? (
        <ConvertPanel
          job={job}
          options={options}
          setOptions={setOptions}
          converting={converting}
          onConvert={convert}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        {settled && !converting ? (
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

/** One slide's detection state, in words rather than colour alone. */
function DetectionLine({
  detection,
  converting,
}: {
  detection: PublicDetection | null;
  converting: boolean;
}) {
  if (!detection) {
    return (
      <span className="text-caption text-muted">
        {converting ? en.convert.slide.running : en.convert.slide.queued}
      </span>
    );
  }
  if (detection.status === "done") {
    return (
      <span className="text-caption text-muted">
        {en.convert.slide.done(detection.blocks)}
        {detection.fromCache ? ` · ${en.convert.slide.cached}` : ""}
      </span>
    );
  }
  if (detection.status === "skipped") {
    return <span className="text-caption text-muted">{en.convert.slide.skipped}</span>;
  }
  const reason = detection.reason ? en.convert.reasons[detection.reason] : null;
  return (
    <span className="text-caption text-warning">
      {en.convert.slide.failed}
      {reason ? ` · ${reason}` : ""}
    </span>
  );
}

function ConvertPanel({
  job,
  options,
  setOptions,
  converting,
  onConvert,
}: {
  job: PublicJob;
  options: PublicConvert["options"];
  setOptions: (next: PublicConvert["options"]) => void;
  converting: boolean;
  onConvert: () => void;
}) {
  const failed = job.slides.filter((slide) => slide.detection?.status === "failed").length;
  const checkbox = (key: keyof PublicConvert["options"], label: string, hint?: string) => (
    <label className="flex items-start gap-2 text-label">
      <input
        type="checkbox"
        checked={options[key]}
        disabled={converting}
        onChange={(event) => setOptions({ ...options, [key]: event.target.checked })}
        className="mt-1"
      />
      <span className="flex flex-col">
        {label}
        {hint ? <span className="text-caption text-muted">{hint}</span> : null}
      </span>
    </label>
  );

  return (
    <section className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2">{en.convert.title}</h2>
        <p className="text-body text-muted">{en.convert.body}</p>
        <p className="text-caption text-muted">{en.convert.disclosure}</p>
      </div>

      <div className="flex flex-col gap-2">
        {checkbox(
          "coverPatches",
          en.convert.options.coverPatches,
          en.convert.options.coverPatchesHint,
        )}
        {checkbox("dropWatermarks", en.convert.options.dropWatermarks)}
        {checkbox("removeWatermark", en.convert.options.removeWatermark)}
      </div>

      <p
        role="status"
        aria-live="polite"
        aria-label={en.convert.liveRegion}
        className="text-caption text-muted"
      >
        {en.convert.calls(job.convert.calls)}
        {job.convert.error ? ` · ${job.convert.error}` : ""}
      </p>

      {job.convert.status === "done" && failed > 0 ? (
        <p className="text-caption text-warning">{en.convert.partial(failed)}</p>
      ) : null}
      {job.convert.status === "interrupted" ? (
        <p className="text-caption text-warning">{en.convert.interrupted}</p>
      ) : null}
      {job.convert.status === "failed" ? (
        <p role="alert" className="text-body text-error">
          {en.convert.failedTitle}
        </p>
      ) : null}
      {job.convert.status === "done" && failed === 0 ? (
        <p className="text-body text-muted">{en.convert.doneBody}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="button" onClick={onConvert} disabled={converting}>
          {converting
            ? en.convert.running
            : failed > 0 || job.convert.status === "interrupted"
              ? en.convert.retry
              : en.convert.start}
        </button>
        {job.convert.hasOutput ? (
          <a className="button" href={`/api/jobs/${job.id}/download`}>
            {en.convert.download}
          </a>
        ) : null}
      </div>
    </section>
  );
}
