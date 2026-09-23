import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  compareNatural,
  createJobId,
  detectType,
  isJobId,
  isRetryable,
  jobPathSegments,
  jobSchema,
  JOB_VERSION,
  limitsFromEnv,
  newJob,
  planJobKind,
  sanitizeDisplayName,
  slideFileName,
  sortImageNames,
  storedFileName,
  upgradeJob,
  type JobFolder,
  type Limits,
  type SourceType,
} from "../lib/jobs/core.ts";

const limits: Limits = { maxUploadBytes: 50 * 1024 * 1024, maxSlides: 40 };

test("job ids are random UUIDs and only that shape is accepted", () => {
  const id = createJobId();
  assert.ok(isJobId(id));
  assert.notEqual(id, createJobId());
  for (const bad of [
    "",
    "..",
    "../../etc/passwd",
    "0000",
    `${id}/..`,
    `${id}\\..`,
    `${id}.json`,
    ` ${id}`,
    `${id}\n`,
    id.toUpperCase(),
    "11111111-1111-1111-1111-111111111111",
    null,
    42,
  ]) {
    assert.equal(isJobId(bad), false, `${String(bad)} must be rejected`);
  }
});

test("file types come from magic bytes, not extensions", () => {
  const cases: Array<[SourceType | null, number[]]> = [
    ["png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["jpg", [0xff, 0xd8, 0xff, 0xe0]],
    ["pdf", [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]],
    ["pptx", [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]],
    // A Windows executable renamed to .png.
    [null, [0x4d, 0x5a, 0x90, 0x00]],
    // An empty ZIP end-of-archive record is not a PPTX candidate.
    [null, [0x50, 0x4b, 0x05, 0x06]],
    [null, []],
    [null, [0x89, 0x50]],
  ];
  for (const [expected, bytes] of cases) {
    assert.equal(detectType(new Uint8Array(bytes)), expected, JSON.stringify(bytes));
  }
});

test("a job is one PPTX, one PDF, or a batch of images", () => {
  assert.deepEqual(planJobKind(["pptx"], limits), { ok: true, kind: "pptx" });
  assert.deepEqual(planJobKind(["pdf"], limits), { ok: true, kind: "pdf" });
  assert.deepEqual(planJobKind(["png", "jpg", "png"], limits), { ok: true, kind: "images" });
  assert.deepEqual(planJobKind([], limits), { ok: false, reason: "empty" });
  assert.deepEqual(planJobKind(["pptx", "png"], limits), { ok: false, reason: "mixed-types" });
  assert.deepEqual(planJobKind(["pdf", "pptx"], limits), { ok: false, reason: "mixed-types" });
  assert.deepEqual(planJobKind(["pptx", "pptx"], limits), { ok: false, reason: "too-many-files" });
  assert.deepEqual(planJobKind(Array(41).fill("png"), limits), {
    ok: false,
    reason: "too-many-images",
  });
  assert.deepEqual(planJobKind(Array(40).fill("png"), limits), { ok: true, kind: "images" });
});

test("limits fall back to the documented defaults for unusable values", () => {
  assert.deepEqual(limitsFromEnv({ MAX_UPLOAD_MB: "10", MAX_SLIDES: "5" }), {
    maxUploadBytes: 10 * 1024 * 1024,
    maxSlides: 5,
  });
  for (const bad of ["", "0", "-1", "abc", "2.5", "99999", undefined]) {
    assert.deepEqual(limitsFromEnv({ MAX_UPLOAD_MB: bad, MAX_SLIDES: bad }), {
      maxUploadBytes: 50 * 1024 * 1024,
      maxSlides: 40,
    });
  }
});

test("stored names are generated, never taken from the upload", () => {
  assert.equal(storedFileName(1, "pptx"), "001.pptx");
  assert.equal(storedFileName(42, "jpg"), "042.jpg");
  assert.equal(slideFileName(7), "007.png");
});

test("job paths are built only from validated, generated segments", () => {
  const id = createJobId();
  assert.deepEqual(jobPathSegments(id), [id]);
  assert.deepEqual(jobPathSegments(id, "slides"), [id, "slides"]);
  assert.deepEqual(jobPathSegments(id, "slides", "001.png"), [id, "slides", "001.png"]);

  for (const bad of ["..", "../other", `${id}/../other`, "", `${id}x`]) {
    assert.throws(() => jobPathSegments(bad), /invalid job id/, `id ${bad}`);
  }
  for (const bad of ["..", "source/../..", "" as string]) {
    assert.throws(
      () => jobPathSegments(id, bad as JobFolder),
      /invalid job folder/,
      `folder ${bad}`,
    );
  }
  for (const bad of [
    "../../job.json",
    "..\\job.json",
    "001.png/../../x",
    "0001.png",
    "001.exe",
    "001.png ",
    "job.json",
  ]) {
    assert.throws(() => jobPathSegments(id, "slides", bad), /invalid job file name/, `file ${bad}`);
  }
  // A file always needs a folder, so nothing can land next to job.json.
  assert.throws(() => jobPathSegments(id, undefined, "001.png"), /needs a folder/);
});

test("display names keep their text but lose control characters and separators", () => {
  assert.equal(sanitizeDisplayName("Rangkuman Materi.pptx"), "Rangkuman Materi.pptx");
  assert.equal(sanitizeDisplayName("../../etc/passwd"), ".. .. etc passwd");
  assert.equal(sanitizeDisplayName("C:\\Users\\deck.pptx"), "C: Users deck.pptx");
  assert.equal(sanitizeDisplayName("deck\u0000\u001b[31m.pptx"), "deck[31m.pptx");
  assert.equal(sanitizeDisplayName("   "), "unnamed file");
  assert.equal(sanitizeDisplayName(""), "unnamed file");
  assert.equal(sanitizeDisplayName("a".repeat(500)).length, 120);
  // Non-ASCII text is content, not a threat, and is kept as typed.
  assert.equal(
    sanitizeDisplayName("Presentasi Kulit — Bab 1.pptx"),
    "Presentasi Kulit — Bab 1.pptx",
  );
});

test("several images are ordered the way a person reads the names", () => {
  assert.deepEqual(sortImageNames(["slide-10.png", "slide-2.png", "slide-1.png", "slide-20.png"]), [
    "slide-1.png",
    "slide-2.png",
    "slide-10.png",
    "slide-20.png",
  ]);
  assert.deepEqual(sortImageNames(["img2.png", "IMG10.png", "img1.png"]), [
    "img1.png",
    "img2.png",
    "IMG10.png",
  ]);
  // Leading zeros must not change the numeric order.
  assert.deepEqual(sortImageNames(["p007.png", "p8.png", "p10.png"]), [
    "p007.png",
    "p8.png",
    "p10.png",
  ]);
  // A digit run far beyond Number.MAX_SAFE_INTEGER still compares correctly.
  assert.equal(compareNatural("a9007199254740993", "a9007199254740992"), 1);
  assert.equal(compareNatural("a", "a"), 0);
});

test("job.json rejects anything the app did not write", () => {
  const job = newJob(createJobId(), Date.now());
  assert.ok(jobSchema.safeParse(job).success);
  assert.equal(jobSchema.safeParse({ ...job, id: "../escape" }).success, false);
  assert.equal(jobSchema.safeParse({ ...job, status: "owned" }).success, false);
  assert.equal(jobSchema.safeParse({ ...job, extra: true }).success, false);
  assert.equal(
    jobSchema.safeParse({ ...job, slides: [{ index: 1, file: "../x.png" }] }).success,
    false,
  );
  const slide = {
    index: 1,
    file: "001.png",
    width: 1920,
    height: 1080,
    origin: "pptx-picture",
    mixed: false,
    hidden: false,
    notes: true,
    detection: null,
  };
  assert.ok(jobSchema.safeParse({ ...job, slides: [slide] }).success);
  assert.equal(
    jobSchema.safeParse({ ...job, slides: [{ ...slide, detection: undefined }] }).success,
    false,
    "a slide written before version 2 is upgraded on read, never accepted raw",
  );
});

test("a version 1 job.json is upgraded on read, and nothing else is", () => {
  const job = newJob(createJobId(), Date.now());
  const old = {
    ...job,
    version: 1,
    slides: [
      {
        index: 1,
        file: "001.png",
        width: 100,
        height: 100,
        origin: "image",
        mixed: false,
        hidden: false,
        notes: false,
      },
    ],
  };
  delete (old as Record<string, unknown>).convert;
  const upgraded = jobSchema.safeParse(upgradeJob(old));
  assert.ok(upgraded.success, "the old file still parses");
  assert.equal(upgraded.data?.version, JOB_VERSION);
  assert.equal(upgraded.data?.slides[0].detection, null, "its slides have no detection yet");
  assert.equal(upgraded.data?.convert.status, "idle");
  assert.equal(upgraded.data?.convert.hasOutput, false);

  // A file that already is version 2 comes back untouched.
  const current = { ...job, convert: { ...job.convert, calls: 7 } };
  assert.deepEqual(upgradeJob(current), current);
});

test("a failed slide is retried only when sending it again could help", () => {
  assert.ok(isRetryable(null), "a slide that was never detected is always retried");
  const base = { blocks: 0, fromCache: false, model: "m" } as const;
  assert.ok(isRetryable({ ...base, status: "failed", reason: "unavailable" }));
  assert.ok(isRetryable({ ...base, status: "failed", reason: "quota-exhausted" }));
  assert.equal(
    isRetryable({ ...base, status: "failed", reason: "invalid-response" }),
    false,
    "the same picture and prompt would come back just as malformed",
  );
  assert.equal(isRetryable({ ...base, status: "done", reason: null, blocks: 3 }), false);
  assert.equal(isRetryable({ ...base, status: "skipped", reason: "mixed" }), false);
});

test("a finished job cannot be restarted or edited", () => {
  assert.ok(canTransition("created", "uploading"));
  assert.ok(canTransition("ready", "extracting"));
  assert.ok(canTransition("extracting", "done"));
  assert.ok(canTransition("extracting", "cancelled"));
  for (const status of ["done", "failed", "cancelled"] as const) {
    assert.equal(canTransition(status, "extracting"), false);
    assert.equal(canTransition(status, "uploading"), false);
  }
  assert.equal(canTransition("created", "done"), false);
  assert.equal(canTransition("ready", "done"), false);
});
