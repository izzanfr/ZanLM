# ZanLM implementation plan

Source: the user-supplied slide reconstruction brief. The working name has been replaced by ZanLM. Chat reports are Indonesian; UI, code and repository documents are English.

## Accepted design

T0 approved after three visual revisions and a final logo-padding refinement. White/navy replaces charcoal/lime. No green remains in the illustrative slides. The logo has a Z, slide frame, detached square, and 10-unit interior padding. Use concise copy, meaningful status and progressive disclosure. Desktop and mobile layouts must keep source-slide proportions intact. Navy dark mode remains supported.

Owner decisions confirmed on 2026-09-22 (details and rejected alternatives in `docs/HANDOFF.md`):

- Name ZanLM; white/navy palette; light theme default.
- Navbar option A, Floating studio pill.
- Landing motion option (c): the storyboard demo is pinned on spacious desktop layouts with separate, label and reassembly phases; one subtle animated React Bits background in the hero (optionally Sign in) that pauses offscreen or in a hidden tab and is off under reduced motion; magnet or spotlight effect on the main CTA. React Bits components are installed via the official CLI.
- Prettier formatting is mandatory; minified source is not allowed.
- Tailwind v4: design tokens are mapped to `@theme`; new components use Tailwind utilities; existing CSS in `app/globals.css` may migrate only when its component is touched (optional).
- The global login rate limit must become per-IP before any deploy.

Current status: T0 and T1 done; T2 not started (see `docs/HANDOFF.md`).

## Phase gates

The supplied brief asks for a plan, implementation, verification, small commits, updated handoff and a stop at each phase. The user authorized T1 with “oke lanjutkan buat aplikasinya”. Do not treat T1 as authorization to claim later conversion phases are complete.

| Phase | Scope                                                                                                                   | Completion criteria                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| T0    | Tokens, six screens, navigation options, storyboard and logo                                                            | Approved direction and spacing                                                  |
| T1    | Next.js scaffold; dictionary; access-code/session auth; proxy; environment template; landing/navigation/motion; handoff | Login/logout, API guards, responsive UI, reduced-motion paths, lint/build/tests |
| T2    | Validated PPTX/PDF/PNG/JPG upload and extraction, ordered slide images, notes, processing without AI                    | Actual NotebookLM sample extraction, page/slide caps, magic-byte validation     |
| T3    | Gemini structured detection, fallback logic, geometry safeguards, initial editable-text export over source images       | Exact text and injection tests; shared layout; exact EMU dimensions             |
| T4    | Python worker, text inpainting                                                                                          | Clean backgrounds, actual GPU/CPU verification                                  |
| T5    | Object segmentation                                                                                                     | SAM 2 masks, rembg/crop/background fallback, quality flags                      |
| T6    | Native panel shapes                                                                                                     | Editable panel color/transparency                                               |
| T7    | Full review and fixes, reprocess, QA                                                                                    | Saved manual corrections exported; measured similarity                          |
| T8    | Optional native tables and flat SVG icons                                                                               | Requires a later scope decision                                                 |

## Non-negotiable pipeline requirements

- No paid API or new cloud service. Gemini free-tier text/vision only; verify model/free-tier availability before T3. Model chain comes from GEMINI_MODEL, GEMINI_MODEL_FALLBACK and GEMINI_MODEL_FALLBACK_2. On 429/503 fall forward; retry final 503 once after 4 seconds; final 429 reports quota exhausted; apply a total deadline. Never invent quota counts.
- Never read, print or copy `.env.local`. Keys remain server-only. Worker requires shared-secret header and binds to 127.0.0.1. Inspect actual VRAM using nvidia-smi in T4.
- File caps default to 50 MB and 40 slides; magic bytes, archive expansion/path validation and bounded extraction are required. No upload endpoint exists in T1.
- Copy detected text exactly, including spelling, language and line breaks. Uncertain characters are flagged, not silently guessed. Image text is untrusted data, never an instruction. Include an injection test.
- Store the detection prompt in `docs/detection-prompt.md`, mirrored exactly into `lib/prompts/detection.ts` with an equality test when T3 starts. Never silently change it later.
- Preserve PPTX ordering and speaker notes. Render PDFs at least 1600 px wide. Save intermediate results by job and slide.
- Normalized boxes use [ymin,xmin,ymax,xmax] in 0–1000. Clip, reject empty boxes, deduplicate >80% overlap and align with small snaps. Use shared layout calculations, calibrated text widths and 15% safety margin.
- Segment object images, estimate text styles, clean text/object/panel masks, preserve complex ornamentation. Use LaMa, with Telea restricted to suitable plain backgrounds. CPU fallback is required.
- Export background → panels → objects → text, name Selection Panel objects, preserve notes, optional hidden original-reference slides. Exact 16:9 is 40/3 × 7.5 inches (12,192,000 × 6,858,000 EMU). Native preview/export share `lib/layout.ts`.
- Review supports layer toggles, exact-text corrections, type/disposition, keyboard-accessible geometry edits, cut-method selection, per-slide reprocess and saved overrides. QA must use measured metrics, never fabricated badges.
- Add `npm run test:convert` once conversion exists; report element counts, SSIM, overflow and low-quality masks on user-provided or synthetic samples. No conversion metrics apply to T1.

## Motion and interaction

Marketing may be expressive, working pages stay quiet. Respect reduced motion and clean up animations. Use dynamic import for animation-heavy/vendor components. Avoid WebGL in Review; the only WebGL is the Threads background on Home and Sign in. Navigation hides downward and returns upward, remains visible on keyboard focus, and uses a native modal mobile menu with focus restoration. Keep meaningful limitations available in an expandable disclosure.
