# ZanLM handoff

Last updated: 2026-09-23. Read `AGENTS.md` first; the full plan is in `docs/plan.md`.

## Phase status

| Phase                               | Status                          | Last commit          | Notes                                                                                                                                                                      |
| ----------------------------------- | ------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0 Design                           | Done                            | `1222ae5`            | Tokens, six mockups, three navbar options, storyboard and logo in `design/` and `docs/T0-design.md`. Navbar A chosen by the owner.                                         |
| T1 Foundation                       | Done                            | see T1 commits below | Auth, sessions, proxy, API guards, i18n, navbar, page transition, landing with Threads background, pinned layer demo and magnetic CTA.                                     |
| T2 Upload and extraction            | Done                            | see T2 commits below | Upload, PPTX/PDF/image extraction with notes, job API, Upload and Processing pages. Plan in `docs/T2-plan.md`.                                                             |
| T3 Gemini detection and text export | In progress, export not started | `d6410fb`            | Prompt, client, policy, cache, `test:detect`, box refinement and watermark removal done. Model and resolution chosen and measured; no bias correction. Export not started. |
| T4 Worker and text inpainting       | Not started                     | —                    |                                                                                                                                                                            |
| T5 Object segmentation              | Not started                     | —                    |                                                                                                                                                                            |
| T6 Native panel shapes              | Not started                     | —                    |                                                                                                                                                                            |
| T7 Review and fix, QA               | Not started                     | —                    |                                                                                                                                                                            |
| T8 Tables and SVG icons (optional)  | Not started                     | —                    |                                                                                                                                                                            |

History note: the previous agent (ChatGPT) built T0 and most of T1 without git and stopped without a handoff. Commit `1222ae5` is that work imported as-is.

### T1 commits

| Commit      | Change                                                                  |
| ----------- | ----------------------------------------------------------------------- |
| `1222ae5`   | Baseline import of the previous agent's work                            |
| `ea63820`   | Handoff docs, T0 approval record                                        |
| `9c650e1`   | Prettier formatting, `format`/`format:check`/`check` scripts, LF        |
| `b379a24`   | Missing `npm run setup` script added                                    |
| `ff19e01`   | Design tokens mapped to Tailwind `@theme`                               |
| `5352f98`   | T1 motion plan                                                          |
| `12aefbd`   | `next-env.d.ts` no longer tracked                                       |
| `6f94194`   | React Bits Threads and Magnet via CLI, `ogl` dependency                 |
| `f67c345`   | Threads background on hero and sign-in, static fallback, contrast tests |
| `e492868`   | Pinned three-phase layer demo                                           |
| `6c45cea`   | Magnetic hero CTA                                                       |
| this commit | T1 closed in the docs                                                   |

## T3 commits (so far)

| Commit    | Change                                                        |
| --------- | ------------------------------------------------------------- |
| `e0f9f2c` | T3 plan                                                       |
| `f3b4de1` | Owner decisions recorded                                      |
| `4282f94` | Detection prompt revised                                      |
| `9664bf8` | Gemini SDK added                                              |
| `61b7a89` | `docs/detection-prompt.md` and its mirrored constant          |
| `06ef683` | Gemini client, fallback policy, cache                         |
| `4473c93` | `npm run test:detect`                                         |
| `5edaf73` | `--max-attempts` and `--budget-minutes` guards                |
| `ab2f4dd` | Watermarks scored apart; spaces at run edges ignored          |
| `971c20a` | Box refinement from the slide's pixels                        |
| `6d83507` | NotebookLM watermark found and removed                        |
| `124ed7f` | Refinement may only shrink; background read inside card edges |
| `68ca79b` | Watermark filled with texture from the same slide             |

## T2 commits

| Commit    | Change                                                                                    |
| --------- | ----------------------------------------------------------------------------------------- |
| `6399b5a` | Lockfile synced (missing optional `@emnapi/*` entries) so `npm ci` works on a fresh clone |
| `0e54509` | Navbar stays visible under reduced motion; specificity guarded by a test                  |
| `26e4082` | Extraction dependencies                                                                   |
| `564722a` | Job ids, storage layout, magic bytes, file-mix rule, job.json schema                      |
| `b604915` | Bounded ZIP reader, hardened XML parser, PPTX order, pictures, notes                      |
| `ed87a91` | PDF extraction (original picture or render) and image normalization                       |
| `2c2bc86` | Job API routes and in-process extraction with cancel                                      |
| `160cdb4` | `npm run test:extract` over `samples/`                                                    |
| `d95d90d` | Upload and Processing pages                                                               |
| this      | T2 closed in the docs                                                                     |

## T2 features and how they were verified

- **Storage:** `data/jobs/<uuid>/` with `job.json` (Zod, strict), `source/`, `slides/`, `notes/`. Every path goes through `jobPathSegments` in `lib/jobs/core.ts`, which validates the id, the folder and the generated file name and throws otherwise. Uploaded names are display text only.
- **Job ids:** `crypto.randomUUID()` on the server only; validated against a strict v4 pattern in every route and on the Processing page before any file access.
- **Upload:** raw-body `PUT`, streamed with a byte counter (50 MB default), type from magic bytes on the first 8 bytes, file-mix rule checked before a byte is written. Rejected uploads are drained within a bounded budget so the 4xx reaches the browser instead of a connection reset.
- **Zip bomb:** `lib/jobs/zip.ts` inflates only requested entries and counts inflated bytes as they arrive (500 MB total, 100 MB per entry, 2,000 entries; 64 MB / 8 MB for the XML pass). Two passes: XML parts first, then only the pictures the deck uses. Tested with a 200 MB bomb in a ~200 KB archive.
- **Zip slip:** entry names are only matched, never written. Traversal-shaped names are not treated as parts; relationship targets that leave the package resolve to nothing.
- **XML:** any `DOCTYPE`, `ENTITY` or `NOTATION` declaration is refused before parsing. fast-xml-parser 5 already refuses external entities, but expands internal DOCTYPE entities by default, so the pre-check is what stops billion laughs. `htmlEntities` is on because numeric references such as `&#233;` otherwise stay literal and mangle notes.
- **Images:** header dimensions checked before decode (max 20,000 px per side, 100 MP, min 8 px), `limitInputPixels` set on every sharp call, EXIF rotation applied. A PNG header rewritten to claim 60,000 × 60,000 is refused.
- **PPTX:** order from `p:sldIdLst` through relationships, hidden slides kept and marked, largest on-slide picture chosen, slide flagged `mixed` when it is not one full-bleed picture (more pictures, a group, any text, or under 98% coverage). Notes copied exactly with `a:br` restored as a newline.
- **PDF (decision 1A):** lossless extraction was feasible. A page that is exactly one full-page image XObject (no text, paths, shadings, masks or forms) keeps the embedded picture at its native resolution. Other pages render at `max(1600 px, 144 dpi)`, capped at 6,000 px, and are flagged mixed. Standard fonts come from `pdfjs-dist/standard_fonts`; nothing is fetched.
- **Several images (decision 3A):** natural order of the uploaded names.
- **Pages:** Upload page with drop zone and a Browse button (dragging is optional), per-file list and errors. Processing page polls every second, announces progress in a live region, shows each slide with its flags, and marks later stages as not yet available. No WebGL.
- **Tests:** 74 unit tests (`npm test`), all fixtures built inside the tests. 53 HTTP smoke checks, including traversal ids, a renamed executable, the size cap, a rejected file mix, the full upload → extract → slide flow and both pages rendering.

### Sample measurement (`npm run test:extract`, 2026-09-22)

`Skin_Barrier_Alchemy.pptx`, 26.8 MB: 15 slides, 15 with a usable picture, 0 mixed, 0 hidden, 0 with speaker notes. Pictures 1376 × 768 (median; max 1672 × 941) on a 16,256,000 × 9,144,000 EMU slide. 32.9 MB of normalized PNG. Structure 14 ms, media inflate 4 ms, decode 1,633 ms.

## T1 features and how they were verified

- Access-code login with SHA-256 + `timingSafeEqual`, HMAC-SHA256 30-day session cookie (`lib/auth/core.ts`, unit tested). `proxy.ts` redirects `/workspace` without a session; every API route checks the session itself. Login endpoint: same-origin, JSON only, 2 KB stream cap, strict Zod body, global rate limit (10 per minute). Verified by 22 HTTP smoke checks.
- All UI copy in `lib/i18n/en.ts`.
- Floating pill navbar (option A): compacts after 48 px, hides on downward scroll, returns on upward scroll, stays visible on focus; GSAP active marker; native `<dialog>` mobile menu with stagger, focus return and scroll lock. Verified in a browser.
- Page transition in `app/template.tsx` (GSAP, reduced-motion aware).
- Animated background (`components/animated-background.tsx`): Threads behind the hero and, at half amplitude, inside the sign-in artwork panel.
  - Lazy mount near the viewport. Threads skips drawing offscreen: measured 22 draw calls per second in view and 0 when scrolled away (headless Chrome, software rendering).
  - Reduced motion, missing WebGL, or a mount failure show the static T0 line motif (`components/line-motif.tsx`). WebGL is probed before `ogl` runs; with `getContext("webgl*")` forced to return null, the fallback appeared with no console error or warning.
  - Colors follow `data-theme` without recreating the WebGL context. Edges fade with a mask.
  - WCAG AA: `tests/contrast.test.ts` reads `app/tokens.css` and checks `ink` and `muted` text against the densest line color at the container opacity, for both themes and both surfaces. A mutation to opacity 0.6 made the test fail as expected.
- Pinned layer demo (`components/slide-demo.tsx`, logic in `lib/demo-motion.ts`):
  - At least 1024 × 700 with motion: pins for 150% of the viewport height. Separate (0–35%, layers lift 12/24/36 px, slide scales to 0.9 so layers stay in the frame), explain (35–70%, four labels), reassemble (70–100%, layers settle, selection boxes fade in).
  - Smaller screens: no pin, short settle scrub, labels as a legend under the slides. Reduced motion: still separated diagram with labels and selection boxes.
  - Verified in headless Chrome at 1440 × 900: document height (3314 px) and the next section's position (2489 px) are identical before, during and after the pin; the section's viewport position is continuous at pin start and end. No pin at 375 × 812, 768 × 1024 or 1280 × 650. After client-side navigation away, no `.pin-spacer` or fixed section remains; returning creates exactly one spacer.
- Magnetic CTA (`components/magnetic.tsx`, logic in `lib/magnet.ts`) on the hero button only: at most about 10 × 5 px of pull, 0 px under reduced motion, off for pointers that cannot hover; keyboard focus ring stays on the link.
- Light/dark theme toggle with cookie. Home and sign-in were screenshotted at 375, 768, 1024 and 1440 px in both themes: no horizontal scroll, exactly one WebGL canvas per page, no console errors.

Browser checks were done ad hoc with the installed Chrome in headless mode driven over the DevTools Protocol from scratch scripts outside the repo. They are not part of `npm run check`.

## Reduced motion checklist (for manual DevTools emulation)

With DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce", then reload:

Must stop or be absent:

- Threads background on the hero and the sign-in panel (no `<canvas>` in the DOM).
- Hero BlurText word animation (the second headline line renders as plain text).
- Demo pinning and scroll scrubbing; manual "Separate layers" jumps instead of animating.
- Magnet pull on the hero CTA.
- Page transition fade/slide; active marker slide and mobile menu stagger become instant (CSS reduces durations to 1 ms).
- Navbar hide/show: the navbar stays visible at all times, it no longer leaves the viewport on downward scroll.
- Sign-in error shake.

Must still be visible and usable:

- The static line motif (three offset rounded frames) on the hero (at least 1000 px wide) and in the sign-in panel.
- The whole demo as a still, separated diagram with the four labels and selection boxes on desktop, or the legend on small screens.
- All links, the CTA, the theme toggle and the layer toggles.

## Decision log

| Date       | Decision                                                                                                                                      | Reason                                                                                                                                                                                                                                  | Rejected alternatives                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 2026-09-22 | Product name ZanLM (replaces working name "Urai Slide")                                                                                       | Owner's choice                                                                                                                                                                                                                          | Urai Slide                                                                              |
| 2026-09-22 | White/navy palette, light theme default, navy dark theme supported                                                                            | Owner's choice during T0 revisions                                                                                                                                                                                                      | Charcoal/lime; dark as default                                                          |
| 2026-09-22 | Navbar option A, Floating studio pill                                                                                                         | Owner's explicit choice; best continuity between marketing and work pages                                                                                                                                                               | B Compact command pill; C Split capsule                                                 |
| 2026-09-22 | Landing animation option (c)                                                                                                                  | Owner wants a lively, animated site with React Bits + GSAP                                                                                                                                                                              | (a) keep static; (b) storyboard without a background                                    |
| 2026-09-22 | React Bits components are installed only via the official CLI; BlurText kept                                                                  | Existing BlurText is byte-identical to the official registry file                                                                                                                                                                       | Replacing BlurText                                                                      |
| 2026-09-22 | Git initialized; previous work committed as a baseline before any change                                                                      | No history existed                                                                                                                                                                                                                      | Rewriting history per feature                                                           |
| 2026-09-22 | Code must be formatted with Prettier; no minified source                                                                                      | Previous code was written as long single lines                                                                                                                                                                                          | Leaving code as-is                                                                      |
| 2026-09-22 | Tailwind: map tokens to `@theme`; new markup uses Tailwind; legacy CSS migrates only when its component is touched, and migrating is optional | Avoid a risky full rewrite                                                                                                                                                                                                              | Rewriting all CSS now; dropping Tailwind                                                |
| 2026-09-22 | Threads as the animated background, on hero and sign-in (half amplitude)                                                                      | Moves on its own, pauses itself offscreen, no global listeners                                                                                                                                                                          | Dot Grid (static without a pointer), Waves                                              |
| 2026-09-22 | Threads line color `#B2C5DD` / `#7696BD` (light/dark), opacity 0.40 on canvas and 0.30 on surface (dark 0.36 / 0.30)                          | Highest opacity that keeps muted text at WCAG AA with margin (limits 0.46/0.35 light, 0.425/0.35 dark)                                                                                                                                  | Navy lines (limit 0.125, nearly invisible)                                              |
| 2026-09-22 | Demo slide scales to 0.9 while separated                                                                                                      | The 36 px text lift otherwise leaves the frame and hits the label above                                                                                                                                                                 | Smaller lift (breaks the storyboard), clipping                                          |
| 2026-09-22 | Magnet on the hero CTA only                                                                                                                   | In the compact navbar the pull left 2.1 px to the pill edge and broke its silhouette                                                                                                                                                    | Navbar CTA magnet                                                                       |
| 2026-09-22 | Reduced motion keeps the navbar always visible                                                                                                | Owner's choice; the old override never applied because of specificity                                                                                                                                                                   | Hiding instantly                                                                        |
| 2026-09-22 | PDF via pdfjs-dist + @napi-rs/canvas; a single full-page picture is taken losslessly, everything else rendered at ≥1600 px                    | Owner decision 1A; lossless extraction proved workable in pdf.js                                                                                                                                                                        | Python worker with pypdfium2 in T2                                                      |
| 2026-09-22 | Dependencies fflate, fast-xml-parser, sharp (direct), pdfjs-dist, @napi-rs/canvas                                                             | Owner decision 2                                                                                                                                                                                                                        | —                                                                                       |
| 2026-09-22 | Several images ordered by natural file-name order; drag to reorder moves to T7                                                                | Owner decision 3A                                                                                                                                                                                                                       | Upload order                                                                            |
| 2026-09-22 | Non-single-image PPTX slides: largest picture extracted and flagged mixed; T3 keeps their native text and shapes                              | Owner decision 4A                                                                                                                                                                                                                       | Rejecting the deck                                                                      |
| 2026-09-22 | Zip limits 500 MB inflated total, 100 MB per entry, 2,000 entries, checked while inflating                                                    | Owner's safeguard list; comfortably above a real deck                                                                                                                                                                                   | Checking declared sizes only                                                            |
| 2026-09-22 | Any XML DOCTYPE/ENTITY is refused outright                                                                                                    | fast-xml-parser expands internal DOCTYPE entities by default; OOXML never has a DOCTYPE                                                                                                                                                 | processEntities off (breaks `&amp;` decoding)                                           |
| 2026-09-23 | Model chain `GEMINI_MODEL=gemini-3.5-flash-lite`, `GEMINI_MODEL_FALLBACK=gemini-3.1-flash-lite`, `GEMINI_MODEL_FALLBACK_2=gemini-3.8-flash`   | Owner's choice from the comparison above: 3.5 Flash-Lite at default resolution has CER 0.0%, no missed block, the best refined IoU (0.801) and the lowest latency. 3.8 Flash is the last tier untested, because its quota was exhausted | Making 3.1 Flash-Lite first (lower IoU, slower); dropping 3.8 Flash from the chain      |
| 2026-09-23 | Default media resolution, not high                                                                                                            | High raises run boundaries (15/18) and finds all three watermarks, but drops slide 12's IoU from 0.777 to 0.476 and starts missing blocks. The watermark is handled in code (`lib/watermark.ts`), so the model finding it buys nothing  | `mediaResolution: high`                                                                 |
| 2026-09-23 | No box-bias correction in the code                                                                                                            | The shift, the y slope and the width ratio disagree across models and resolutions, and the per-pair spread is as large as the bias (numbers above). T3 plan 7.8 asks for agreement before correcting                                    | Applying the 2026-09-22 figures (-1.3% shift, 0.974 slope, 15% too wide) to every model |
| 2026-09-23 | The watermark mask keeps its core solid and grows two pixels, skipping detailed pixels                                                        | No pixel of the mark can be blended back into its replacement, and the fade lands on background. Growing without the guard changed the gold frame by up to 98 of 255 in luma                                                            | Growing by four or more; fading inside the mark, as before                              |

## Model comparison and box bias (measured 2026-09-23, morning WIB)

`npm run test:detect -- --model gemini-3.5-flash-lite --model gemini-3.1-flash-lite --model gemini-3.8-flash --media-resolution default --media-resolution high --max-attempts 3 --budget-minutes 25`, on the five ground-truth slides plus the injection slide. Four of six combinations were measured; the report and overlays are in `data/detect-report/2026-09-23T02-29-29-065Z/` (git-ignored).

| Combination              | CER  | Missed | IoU, Gemini -> refined | Run boundaries | Table cells | Watermarks | Mean latency | Injection |
| ------------------------ | ---- | ------ | ---------------------- | -------------- | ----------- | ---------- | ------------ | --------- |
| 3.5-flash-lite @ default | 0.0% | 0/42   | 0.773 -> **0.801**     | 13/18          | 20/20       | 2/3        | 6,410 ms     | PASS      |
| 3.5-flash-lite @ high    | 1.5% | 1/42   | 0.612 -> 0.644         | 15/18          | 20/20       | 3/3        | 6,078 ms     | PASS      |
| 3.1-flash-lite @ default | 0.0% | 0/42   | 0.655 -> 0.695         | 14/18          | 20/20       | 1/3        | 10,693 ms    | PASS      |
| 3.1-flash-lite @ high    | 0.0% | 0/42   | 0.655 -> 0.695         | 14/18          | 20/20       | 1/3        | 9,982 ms     | PASS      |
| 3.8-flash @ either       | —    | —      | not measured           | —              | —           | —          | —            | FAIL      |

`gemini-3.8-flash` ran out of quota: 12 x 429 and 1 x 503, no answer at either resolution, so it is the last tier on paper only. `gemini-3.1-flash-lite` returned byte-identical answers at default and high; the cache key does include the resolution (`cacheKey` in `lib/gemini/cache.ts`), so that is the model's own behaviour, not a cache hit.

### Box bias (0 requests, recomputed from that report)

Matched pairs only, box centres and sizes against the ground truth. Negative `dy` means the box sits too high.

| Combination              | Pairs | dy (% of height) | y slope | Width ratio    | Height ratio   | dx (%) |
| ------------------------ | ----- | ---------------- | ------- | -------------- | -------------- | ------ |
| 3.5-flash-lite @ default | 44    | -0.46 (+-0.66)   | 0.996   | 1.012 (+-0.12) | 0.927 (+-0.14) | +0.12  |
| 3.5-flash-lite @ high    | 44    | -1.24 (+-1.27)   | 0.983   | 0.993 (+-0.10) | 0.866 (+-0.20) | -0.04  |
| 3.1-flash-lite @ default | 43    | -1.03 (+-1.13)   | 0.980   | 1.127 (+-0.18) | 0.928 (+-0.19) | +0.09  |
| 3.1-flash-lite @ high    | 43    | -1.03 (+-1.13)   | 0.980   | 1.127 (+-0.18) | 0.928 (+-0.19) | +0.09  |

The T3 plan (7.8) allows a correction only when direction and magnitude agree across the runs. They do not. The width ratio runs from 0.993 to 1.127, so the earlier "15% too wide" is one model's habit, not the family's; for the chosen combination width is already right (1.012). The vertical shift keeps its sign but varies almost threefold, and its spread per pair (+-0.66 to +-1.27) is as large as the bias itself. The y slope is 0.996 for the chosen combination, so the earlier 0.974 ("boxes drift higher lower down the slide") is not reproduced either. **No bias correction goes into the code.** The one consistent number is height: boxes are 7 to 13% too short in every run, which shrink-only refinement cannot help; that is a candidate for the Review page in T7, not for a blind correction.

## Known issues

- **Box refinement is measured on 36 cached pairs only (2026-09-23).** Shrink-only, with the inside-the-box background estimate for card edges: IoU 0.619 to 0.671 overall; slide 1 0.887 to 0.884, slide 4 0.531 to 0.581, slide 12 0.617 to 0.675, slide 14 0.838 to 0.869. Letting boxes grow scored 0.693 overall but broke slide 1 (0.781); the owner chose shrink-only. **Bias correction stays out of the code (measured 2026-09-23, see the decision log).**
- **The watermark fill leaves specks on plain backgrounds (2026-09-23).** The words themselves are gone everywhere: with the mark's own high-pass pattern as a template, 0.04 of it survives on slide 9 and 0.00 on slide 12 (1.00 is the untouched slide). What is left is the pasted texture itself, measured as residual RMS in the letter box against the real background beside it: slide 7 15.5 against 1.2, slide 14 6.4 against 0.5, slide 5 6.1 against 1.0, slide 12 4.7 against 1.8, slide 9 25.5 against 22.3 (indistinguishable from the slide's own grain). Where the real background is nearly noiseless, the mirror donates stars and dark blotches that are visible as specks at 5x. Only the sample deck has been seen. T4 runs the same mask through LaMa (`docs/plan.md`), which is the fix for those specks.

- **Speaker notes are only covered by synthetic tests.** The one real sample has no notes. Check a deck with notes before relying on them in T3.
- **NotebookLM pictures are low resolution:** 1376 px wide on a 17.8-inch slide is about 77 dpi. Detection in T3 works on that, nothing upstream can improve it.
- A PPTX slide without any usable picture is skipped rather than kept as an empty slide, so slide numbers shift after it. The sample has none; revisit if a real deck shows one.
- Extraction runs inside the Next process and its cancel map is in memory: restarting the server leaves a running job stuck at "extracting". Acceptable for T2; the worker in T4 is the place for a real queue.
- Job folders are never cleaned up automatically. Delete them from `data/jobs/` or with `DELETE /api/jobs/[id]`.
- `npm install` warns that `unrs-resolver`'s install script is not covered by `allowScripts`; approve it with `npm approve-scripts unrs-resolver` if lint misbehaves on a fresh clone.

- **Login rate limit is one global bucket** (`createLoginLimiter` in `lib/auth/core.ts`). Anyone can lock sign-in for 60 seconds. Acceptable for loopback-only use; **must be replaced with a per-IP limiter (using a trusted proxy header) before any deploy.**
- `.env.local` exists; the owner created it by hand in PowerShell after `npm run setup` kept failing (fixed since, see the setup note below). Process environment variables override `.env.local` in Next.js, so stale `ACCESS_CODE`/`SESSION_SECRET` in the Windows environment must be removed first.
- `npm run setup` was rewritten to read masked input in raw mode itself instead of through readline (`scripts/hidden-input.mjs`, unit tested). The original failure could not be reproduced by automation: the old script passed in classic cmd and PowerShell consoles, through `npm run`, and under a ConPTY host speaking Windows Terminal's win32-input-mode, including a leftover Enter key-up, a pasted line and slow typing. The most likely remaining cause is a code containing characters outside `A-Z a-z 0-9 _ -`, which the old script rejected with the same generic message. The new script says exactly why a code is rejected, shows `*` per character, retries up to three times, and passed 24 real-console cases and 16 ConPTY cases (valid, Backspace, mismatch then retry, symbols, Ctrl+C, existing file untouched, key-up, paste, slow typing).
- Real-GPU frame rate of Threads was not measured; headless checks used software rendering. Check the Performance panel on the laptop.
- Hidden-tab pausing of Threads relies on its own `document.hidden` check plus the browser pausing `requestAnimationFrame`; only the offscreen pause was measured.
- Threads keeps a `requestAnimationFrame` loop alive while offscreen (it skips the draw); the cost is a no-op callback per frame.
- On desktop the four in-slide labels are briefly visible between server render and hydration before the pinned timeline hides them. No layout shift; opacity only.
- Legacy components still use class-based CSS in `app/globals.css` (see AGENTS.md, Styling).
- `node_modules` contains three extraneous packages (`@img/sharp-wasm32`, `@napi-rs/wasm-runtime`, `@tybys/wasm-util`); harmless, removable with `npm prune`.
- `scripts/setup.mjs` writes the access code in plain text to `.env.local` (needed because the server hashes both sides at compare time). The `0o600` file mode has no effect on Windows; the file is protected only by the user profile ACL and `.gitignore`.
- `npm start` sets Secure cookies, so production mode over plain HTTP cannot sign in; use `npm run dev` locally.

## Next steps

1. **Set the machine up** (see "Moving to another computer" below): clone, `npm ci`, write `.env.local` with `npm run setup`, put `GEMINI_API_KEY` and the three model variables in it by hand, and unpack the samples-and-cache archive, which is git-ignored and therefore not on GitHub.
2. **The export commits** (T3 plan, section 11, from commit 5), with the refined boxes, the watermark option and the resume behaviour in section 8. Nothing of the PPTX export exists yet.
3. Owner checks reduced motion with the checklist above.

The model comparison (old step 2) and the box-bias measurement (old step 3) are done; both are in the decision log below.

## Moving to another computer

Everything is on GitHub except two git-ignored folders, `samples/` and `data/cache/gemini/`, which hold the sample deck, the ground truth and every cached Gemini answer. They are shipped as a zip archive kept outside the repository.

1. `git clone` the repository and `npm ci`.
2. `npm run setup` to write `.env.local` (access code and session secret), then add these by hand; the file is never read or printed by the agent:

   ```
   GEMINI_API_KEY=...
   GEMINI_MODEL=gemini-3.5-flash-lite
   GEMINI_MODEL_FALLBACK=gemini-3.1-flash-lite
   GEMINI_MODEL_FALLBACK_2=gemini-3.8-flash
   ```

3. Unpack the archive into the repository root, so that `samples/ground-truth/` and `data/cache/gemini/` exist again. Without the cache, the comparison starts from zero calls; without `samples/`, `npm run test:detect` has no ground truth to score against.
4. `npm run check` and `npm run build` to confirm the machine is sound (170 tests).
5. `npm run test:detect -- --cache-only` to confirm the cache arrived: it makes no network call at all.
