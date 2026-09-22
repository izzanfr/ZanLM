# T2 plan: upload, extraction and Processing page (awaiting owner approval)

Goal from `docs/plan.md`: validated PPTX/PDF/PNG/JPG upload, ordered slide images, speaker notes, and a Processing page, all without AI.
Done when a real NotebookLM sample deck extracts into one PNG per slide in the right order with its notes, caps and magic-byte checks are enforced, and lint, build and tests pass.

## 1. Scope

In scope:

- Upload page (replaces the current `/workspace` placeholder), following `design/03-upload.svg`.
- Job storage in `data/jobs/<id>/` (git-ignored), no database.
- Extraction: PPTX → slide images in presentation order + speaker notes; PDF → one PNG per page, at least 1600 px wide; PNG/JPG → one slide per file.
- Processing page (`/workspace/jobs/[id]`), following `design/04-processing.svg`, with real progress for the extraction stage and cancel.
- API routes, each checking the session itself.

Out of scope (later phases): Gemini detection (T3), worker, inpainting, segmentation (T4–T5), export, Review, Download.

## 2. Dependencies (need approval)

All free, permissive licenses, checked with `npm view` on 2026-09-22.

| Package           | Version | License    | Why                                                                                                                                                                                      |
| ----------------- | ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fflate`          | 0.8.3   | MIT        | Read PPTX (ZIP) entries in memory with our own size and ratio limits                                                                                                                     |
| `fast-xml-parser` | 5.11.1  | MIT        | Parse `presentation.xml`, slide and notes XML                                                                                                                                            |
| `sharp`           | 0.35.4  | Apache-2.0 | Decode, validate and normalize images to PNG; pixel limit against decompression bombs. Already installed as a Next.js optional dependency; would become a direct one at the same version |
| `pdfjs-dist`      | 6.3.289 | Apache-2.0 | Parse and render PDF pages                                                                                                                                                               |
| `@napi-rs/canvas` | 1.0.9   | MIT        | Canvas for pdf.js in Node (prebuilt Windows binary, no build tools)                                                                                                                      |

Alternative for PDF (decision 1, option B): render PDFs in the Python worker with `pypdfium2` (Apache-2.0/BSD). This would pull the worker forward from T4 into T2.

## 3. Storage layout

```
data/jobs/<uuid>/
  job.json            status, source type, file list, per-slide state (Zod schema)
  source/001.pptx     uploaded files, renamed; original names kept only in job.json
  slides/001.png      normalized slide images, 1-based, zero-padded
  notes/001.txt       speaker notes (PPTX only, when present)
```

- Job ids are `crypto.randomUUID()` values and are validated with a strict regex on every request, so a path can never come from user input.
- Original file names are stored as data only (length-limited, control characters removed) and never used as paths.

## 4. API (all under `app/api/jobs/`)

| Method and route                | Purpose                                                                                            | Guards                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /api/jobs`                | Create an empty job                                                                                | session, same-origin                                                                              |
| `PUT /api/jobs/[id]/files`      | Upload one file as a raw request body (`X-File-Name` header), streamed to disk with a byte counter | session, same-origin, 50 MB cap (`MAX_UPLOAD_MB`), magic bytes on the first bytes, file-mix rules |
| `POST /api/jobs/[id]/start`     | Start extraction in the Next.js process                                                            | session, same-origin                                                                              |
| `GET /api/jobs/[id]`            | Job status for polling                                                                             | session                                                                                           |
| `POST /api/jobs/[id]/cancel`    | Cancel a running extraction                                                                        | session, same-origin                                                                              |
| `GET /api/jobs/[id]/slides/[n]` | Slide PNG for thumbnails                                                                           | session                                                                                           |
| `DELETE /api/jobs/[id]`         | Delete a job folder                                                                                | session, same-origin                                                                              |

Raw-body upload instead of `multipart/form-data`: the stream can be counted and cut off at the cap without buffering 50 MB, and there is no multipart parser to trust. The page uploads files one by one and shows per-file progress.

File-mix rules: one PPTX, or one PDF, or 1–40 PNG/JPG images. Mixed types are rejected with a clear message. `MAX_SLIDES` (default 40) is enforced again after extraction.

## 5. Validation and extraction

Magic bytes (not extensions): PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, PDF `%PDF-`, PPTX `PK 03 04` plus a `[Content_Types].xml` declaring the presentation content type and a `ppt/presentation.xml` entry.

PPTX:

- Limits before and during inflation: at most 2,000 entries; entry names without absolute paths, drive letters, backslashes or `..`; XML entries at most 5 MB each; total inflated bytes at most 400 MB counted while inflating (declared sizes are not trusted); inflate/deflate ratio at most 200.
- Order: `p:sldIdLst` in `ppt/presentation.xml` → relationship ids → slide parts. Hidden slides are kept and marked hidden.
- Image per slide: the `p:pic` whose bounds cover the most of the slide (`p:sldSz`). A slide that is not a single full-slide picture (for example text boxes plus images) is still extracted from its largest picture and flagged "Not a single-image slide" instead of being dropped silently (decision 4).
- Notes: the slide's `notesSlide` relationship, body placeholder text, paragraphs joined with line breaks, text kept exactly.

PDF: pages rendered at `max(1600 px, page width at 144 dpi)` wide; more than 40 pages is rejected before rendering; scripting and font fetching are disabled.

Images: decoded with `sharp` using a pixel limit (50 MP), EXIF rotation applied, output as PNG. Order for several images: natural file-name order (decision 3).

All parsers are pure functions with unit tests on synthetic files built in the tests (a tiny PPTX assembled with `fflate`, generated PNG/JPEG/PDF bytes). No private sample goes into the repo.

## 6. Pages

- Upload (`/workspace`): drag-and-drop zone plus a "Browse files" button, accepted formats and caps listed, per-file validation messages next to the list, data disclosure (slide images will go to Gemini starting in T3; nothing leaves the laptop in T2). Calm motion only: drop-zone highlight on drag, list items fade in (motion tokens, reduced-motion safe). Tailwind for all new markup.
- Processing (`/workspace/jobs/[id]`): one card per slide with a thumbnail once extracted, stage row "Extract → Detect → Segment → Clean background → Assemble". Only Extract is live; later stages say "Available in a later phase", never a fake success. Worker status reads "Not set up yet"; no Gemini quota is shown because none exists yet. Cancel button; polling every second while running. A live region announces progress. No WebGL.

## 7. Tests and measurements

- Unit (`node --test`): magic bytes, id and file-name validation, file-mix rules, ZIP limits (path traversal, too many entries, inflation bomb), PPTX order with shuffled part names, hidden slides, notes text kept exactly (including Indonesian text), largest-picture choice, image normalization, job state transitions.
- Smoke (`npm run test:smoke`): new routes return 401 without a session, 403 cross-origin, 413 over the cap, 415 for a renamed `.exe`, and a full upload → start → poll → slide image flow with a generated PNG.
- `npm run test:extract`: extracts every file in the git-ignored `samples/` folder and prints per file the slide count, image sizes, notes found, flagged slides and duration. The phase report will quote these numbers.

## 8. Commits

1. `chore: add extraction dependencies`
2. `feat: add job storage and upload validation`
3. `feat: extract PPTX slides and notes`
4. `feat: extract PDF pages and images`
5. `feat: add job API routes`
6. `feat: add upload page`
7. `feat: add processing page with cancel`
8. `test: add sample extraction script` and `docs: close T2`

Each commit passes `npm run check` and `npm run build`; commits touching routes also pass `npm run test:smoke`.

## 9. Decisions for the owner

1. PDF rendering: **(A, recommended)** `pdfjs-dist` + `@napi-rs/canvas` in Node, so T2 needs no Python; or (B) bring the Python worker forward and use `pypdfium2`.
2. Approve the five dependencies in section 2.
3. Several images in one job: **(A, recommended)** natural file-name order (`slide-2` before `slide-10`); or (B) upload order; or (C) A plus drag-to-reorder on the Upload page (more work).
4. PPTX slides that are not a single full-slide picture: **(A, recommended)** extract the largest picture and flag the slide; or (B) reject the whole deck.
5. Sample files: please put at least one real NotebookLM `.pptx` (and a PDF export if you have one) into `samples/`. The folder is git-ignored and I will not commit or quote its content, only counts and sizes.
