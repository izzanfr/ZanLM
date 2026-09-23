# T4 plan: text pixel mask, LaMa worker, clean backgrounds

**Status: written 2026-09-23, waiting for the owner's approval. No T4 code exists, and nothing is installed.**

Read `AGENTS.md` first. `docs/HANDOFF.md` has the current state, `docs/T3-plan.md` the phase this one builds on.

## 1. Why T4 exists now

The first exported deck showed the real problem, and it is not the exporter: **the original text is still inside the background picture**. Every line therefore reads twice, once from the picture and once from the new text box. The cover patch was the stopgap and it failed on both counts (`docs/T3-plan.md`, 7.2): on a textured slide it is a flat rectangle, and sized from the detected box it does not even cover the text it should hide. Patches are off by default since 2026-09-23.

T4 removes the text from the picture. That is what makes the export honest, and the same work also fixes two other things, because all three need one thing: **which pixels are text**.

## 2. What is already measured (no new work needed)

- **This machine:** Python 3.12.4 (Anaconda, `pip` 24.0), NVIDIA GeForce RTX 4050 Laptop, **6,141 MiB VRAM**, driver 591.74 (CUDA 13.1), 161 GB free on C:. The master plan asks for real `nvidia-smi` numbers in T4; these are them.
- **Detection quality** (`gemini-3.5-flash-lite` at default resolution): CER 0.0%, no missed blocks, refined IoU 0.801.
- **Box height bias:** boxes come back 7 to 13% too short in every model and resolution, which is why the exporter computes the height (T3 plan 7.4).
- **Chosen font size against the real text:** over 42 blocks the mean ratio is 0.98 and the median 1.00, but the spread runs from **0.40 to 1.47**, with 9 blocks more than 10% too large and 11 more than 10% too small (HANDOFF, known issues). This is the number T4 has to move.
- **Watermark removal** is code-only and already good on 12 of 13 sample slides; slide 8, whose mark sits inside the gold ornament, rebuilds ornament that is not the original.

## 3. The text pixel mask (one module, three users)

`lib/text-mask.ts`: **pure**, no worker, no model, no network. Raw pixels and a block's box in, a mask and a few measurements out. It is the first commit of T4 and it is useful on its own, before any Python exists.

```
maskForBlock(image: RawImage, box: Rect, textColor?: string, options?) => {
  mask: Uint8Array;        // 1 where the block's own ink is, 0 elsewhere
  rows: Array<[number, number]>;  // ink rows, first and last, per visual line
  linePitchPx: number | null;     // baseline to baseline, null for one line
  inkHeightPx: number;            // cap plus descender of the ink itself
  coverage: number;               // share of the box that is ink
  confident: boolean;             // false when the estimate is weak
}
```

**How it finds ink.** The machinery exists in `lib/box-refine.ts` and is reused rather than rewritten: estimate the background from a ring around the box (or, when the box crosses a card edge, from the colour that fills most of the box), keep pixels near the detected text colour, fall back to plain contrast when that colour matches almost nothing, and drop long straight runs that are frame lines rather than letters. What is new is that the result is kept **as a mask**, not collapsed into a rectangle, plus the row analysis: rows are ink or not, runs of ink rows are visual lines, and the distance between the first ink row of one line and the first of the next is the line pitch.

**Three users, one mask:**

| User                               | What it takes                                                       | Why                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| LaMa (section 4)                   | `mask`, dilated a little, unioned per slide with the watermark mask | The pixels to paint out of the background                                                                    |
| Cover patch, when the option is on | the mask's bounding rows and columns, not the detected box          | A patch sized from the text it hides actually hides it; this is the failure the owner saw on slides 4 and 12 |
| Font size (below)                  | `linePitchPx`, `inkHeightPx`                                        | The detected box is the wrong ruler                                                                          |

### 3.1 Font size from the ink, not from the box

Today `layoutBlock` takes its height limit from the detected box, and that box is 7 to 13% too short with a wide spread, so the size misses in both directions. The rule changes to:

1. **Several lines:** the size is `linePitchPx` converted to points, divided by the face's `lineFactor`. The pitch is baseline to baseline in the picture, which is exactly what one line of text at that size occupies.
2. **One line:** there is no pitch, so the size comes from the ink height: `inkHeightPx` in points divided by the face's own cap-plus-descender ratio, measured from the same font file with `@napi-rs/canvas`.
3. **The width limit is unchanged** and still wins when it is smaller, so a line can never overflow its box.
4. **When the mask is not confident** (little ink, an ornament through the box, `coverage` too low or too high), the old rule applies: the detected box height, with the block flagged for the Review page in T7. Nothing is ever sized from a guess without saying so.
5. The computed **height rule of T3 (7.4) stays**: the box height is still `size × lines × lineFactor + padding`, so text is never clipped.

**How it is measured, with the same method as before.** `npm run test:sizes` (new, cache only, 0 requests) reports, per block, the chosen line height against the measured one: the pitch for multi-line blocks, the ink height for single-line blocks. **The target is that no block sits outside 0.9 to 1.1**, with the mean staying near 1.00. Today: mean 0.98, median 1.00, range 0.40 to 1.47, 20 of 42 blocks outside the target. The commit is not finished until that table is in HANDOFF, whatever it says. If some blocks cannot reach the band, they are named with the reason rather than averaged away.

## 4. The worker

### 4.1 What it is

`worker/`: a small FastAPI application, started by hand, that does one thing: take a PNG and a mask, return the PNG with the masked pixels inpainted.

- `POST /inpaint` — body: the slide PNG and the mask PNG (multipart). Header: `X-Worker-Secret`, compared with `WORKER_SECRET` in constant time. Response: the inpainted PNG.
- `GET /health` — model loaded, device in use (`cuda` or `cpu`), model name. No secret needed, so the app can show the state before a job runs.
- **Binds `127.0.0.1` only** (master plan). No CORS, no other route, no file paths in the request: bytes in, bytes out, nothing written to disk by the worker.
- Request size cap (the slide images are about 1.3 MP; a 20 MB cap is generous) and a per-request timeout.
- Logs: sizes, device and milliseconds. **Never the image, never the mask, never a job id.**

### 4.2 Model and dependencies, to be confirmed before anything is installed

This is the part the owner approves, and the numbers must be checked rather than assumed. Before installing, I will report, from the real index and the real repository:

| To confirm                                                                                      | Why it matters                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `big-lama` checkpoint size on disk                                                              | It is downloaded once and kept in `worker/models/`, which is git-ignored                                                                                                                                                                           |
| **The weights' licence**                                                                        | The LaMa code is Apache-2.0, but the released `big-lama` weights have their own terms, and at least one release is non-commercial. A personal, local tool is very likely fine, but the terms go in the decision log before the download, not after |
| Whether the packaged wrappers (`simple-lama-inpainting`, `iopaint`) pull in more than they need | Fewer dependencies is better than convenience here                                                                                                                                                                                                 |
| Torch wheel size for CUDA against CPU-only                                                      | The CUDA wheel is by far the biggest download of this project                                                                                                                                                                                      |

Everything is installed into `worker/.venv`, never into the Anaconda base environment, and pinned in `worker/requirements.txt`. **Nothing is installed until the owner has seen those four answers.**

The fallback if the licence or the size is not acceptable: OpenCV's Telea and Navier-Stokes inpainting, which need no model at all and are already allowed by the master plan for plain backgrounds. They are visibly worse on ornament, so they are a fallback, not the plan.

### 4.3 Running it on Windows

```
python -m venv worker\.venv
worker\.venv\Scripts\pip install -r worker\requirements.txt
npm run worker            # new script: starts uvicorn on 127.0.0.1:8008
```

`npm run worker` is a convenience only; the worker is a separate process with its own lifetime, and the app never starts or stops it. `WORKER_URL` and `WORKER_SECRET` are already in `.env.example`.

**GPU and CPU.** The worker asks Torch for CUDA and uses it when it is there, reporting the device through `/health`. The 6 GB card is comfortable for one 1376 × 768 slide; the tile size stays configurable so a bigger deck cannot exhaust VRAM, and an out-of-memory error falls back to CPU for that request rather than failing it. CPU-only is a supported way to run, just slower.

**Time per slide: to be measured, not guessed.** Both devices are timed on the sample deck and the numbers go in HANDOFF. What the plan commits to is the shape of the decision: if the CPU path is slower than roughly ten seconds per slide, the UI says so before the job starts, because a 40-slide deck then takes minutes.

### 4.4 When the worker is not running

This is a normal state, not an error. The worker is started by hand, and the owner will often convert without it.

- **The conversion still runs and still produces a deck.** Inpainting is a step that can be skipped, exactly like a slide whose detection failed (decision 7A).
- The background keeps its text, and every affected slide is flagged in `job.json` (`inpaint: "skipped"` with a reason: `worker-down`, `worker-error`, `timeout`).
- The Convert panel shows the worker state **before** the job starts, from `/health`: "Background cleaning: worker not running — the text will stay in the picture." Afterwards the result line says how many slides were cleaned.
- The app probes `/health` with a short timeout and never blocks a conversion on it. One failed slide does not stop the job; a worker that dies mid-job leaves the rest of the slides uncleaned and marked.
- A conversion can be run again once the worker is up: the detections are already on disk, so **cleaning again costs no Gemini call at all** (this is the same resume path as T3).

## 5. Order of work, in small commits

Each commit passes `npm run check` and `npm run build`; commits touching routes also pass `npm run test:smoke`.

1. `feat: find the text pixels of a block` — `lib/text-mask.ts` and its unit tests, on synthetic slides. No caller yet. Also the measurement tool `npm run test:sizes`, reporting today's numbers so the change has a baseline.
2. `feat: size text from its own ink` — `layoutBlock` uses the pitch and the ink height, with the confidence fallback. **Report: the size table before and after, against the 0.9 to 1.1 target.**
3. `feat: size cover patches from the text mask` — the option stops using the detected box. Report: the slides where the old patch missed (4 and 12) now covered, with crops.
4. `docs: record the worker dependencies and the model licence` — the four answers of 4.2. **Stop for the owner's approval; nothing is installed before this.**
5. `feat: add the inpainting worker` — `worker/` with FastAPI, the secret header, `/health`, `/inpaint`, `pytest` tests with a fake model, and `worker/requirements.txt`.
6. `feat: clean the background through the worker` — the app calls the worker per slide, unions the text masks with the watermark mask, records `inpaint` per slide, and skips cleanly when the worker is down. Smoke checks with no worker running.
7. `feat: show the worker state on the Convert panel` — copy in `lib/i18n/en.ts`, the health probe, the per-slide line.
8. `test: verify the exported deck in PowerPoint` — `verify-pptx.ps1` (section 7).
9. `docs: close T4` — measured results, timings on both devices, and what is still open.

Cover patches stay off by default throughout. Whether commit 3 changes that is the owner's call, made on the crops, not in advance.

## 6. How the result is measured

The same discipline as the watermark work: numbers first, pictures second, and the pictures rendered with an identical contrast stretch on both sides so nothing is flattered by the viewer.

**Slides measured before and after, at least:** 1 (plain, large title), 4 (three cards, the worst size misses, the patch that did not cover), 9 (light background, the frame corner), 12 (table, the patch that did not cover), 14 (dark, nearly noiseless background), and **8, whose watermark sits inside the gold ornament** — the one slide where the current fill rebuilds ornament that is not the original, and the clearest test of whether LaMa is actually better than the code fill.

**Numbers per slide:**

- **Text left behind:** the mark's own pattern projected onto the result, the measure already used for the watermark (1.00 is untouched, 0 is gone), computed over each text block's mask.
- **Residual RMS inside the block against the real background beside it**, with the count of pixels standing far above that background's grain — the speck count that caught the starfield.
- **Ornament damage:** the worst luma change on detailed pixels the mask never covered, which must stay at 0.
- **Time per slide**, on GPU and on CPU.

**The decision this produces:** whether LaMa replaces the code fill for the watermark as well (master plan, owner decision 2026-09-22), or only handles the text areas. Slide 8 decides it, and the owner decides it, on the crops.

## 7. `verify-pptx.ps1`, and why it comes at the end

Every size statement so far is a measurement **on the picture**, never on a slide rendered by PowerPoint. LibreOffice is not PowerPoint: its font substitution and line breaking differ, so a deck that looks right there can still wrap or clip in the real thing.

The script (T3 plan, section 9) opens the exported deck through PowerPoint's COM automation on this machine and reports, per shape: position and size in EMU, the font name and size PowerPoint actually resolved, the number of lines after its own wrapping, and whether any text overflows its box. It writes a table, not a screenshot, so the numbers can be compared with the ones computed here.

**It is written in commit 8, after the size rule changes, for one reason:** running it now would measure a deck whose sizes are about to change. It runs against the deck produced in commit 6, and its table is what closes the question of whether the computed height and the new size rule hold in the application people actually open. If it finds clipping or substitution, that is a T4 bug and it is fixed in T4, not deferred.

The script needs PowerPoint installed and runs on Windows only. It is never part of `npm run check`; it is a tool the owner and I run deliberately, like `npm run test:detect`.

## 8. What could stop this

- **The weights' licence** is not acceptable for this tool. Then: Telea and Navier-Stokes for plain backgrounds, and the honest statement that ornamented slides keep their text.
- **The download is too large** for the owner's connection or disk. Same fallback, or a smaller inpainting model if one with acceptable terms exists.
- **The mask is not reliable enough** on this deck's ornamented slides. Then LaMa still runs, but on the detected box rather than the ink, which cleans more of the picture than it needs to; the measurement in section 6 shows whether that trade is acceptable.
- **CPU is too slow to be usable** and the owner does not want to start a worker by hand. Then the option stays off by default and the app keeps saying plainly that the text is still in the picture.

## 9. Decisions this plan needs from the owner

1. **Approve or refuse the dependency set** after the four answers of 4.2, in particular the weights' licence.
2. **Where the model file lives** and whether a one-time download of that size is acceptable on this machine.
3. After commit 3: whether **cover patches go back on by default**, on the crops.
4. After commit 6: whether LaMa also takes over the **watermark** area, on slide 8's crops.
