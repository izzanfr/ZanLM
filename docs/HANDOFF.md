# ZanLM handoff

Last updated: 2026-09-22. Read `AGENTS.md` first; the full plan is in `docs/plan.md`.

## Phase status

| Phase                               | Status                 | Last commit          | Notes                                                                                                                                  |
| ----------------------------------- | ---------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| T0 Design                           | Done                   | `1222ae5`            | Tokens, six mockups, three navbar options, storyboard and logo in `design/` and `docs/T0-design.md`. Navbar A chosen by the owner.     |
| T1 Foundation                       | Done                   | see T1 commits below | Auth, sessions, proxy, API guards, i18n, navbar, page transition, landing with Threads background, pinned layer demo and magnetic CTA. |
| T2 Upload and extraction            | Plan awaiting approval | —                    | `docs/T2-plan.md`                                                                                                                      |
| T3 Gemini detection and text export | Not started            | —                    |                                                                                                                                        |
| T4 Worker and text inpainting       | Not started            | —                    |                                                                                                                                        |
| T5 Object segmentation              | Not started            | —                    |                                                                                                                                        |
| T6 Native panel shapes              | Not started            | —                    |                                                                                                                                        |
| T7 Review and fix, QA               | Not started            | —                    |                                                                                                                                        |
| T8 Tables and SVG icons (optional)  | Not started            | —                    |                                                                                                                                        |

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

| Date       | Decision                                                                                                                                      | Reason                                                                                                 | Rejected alternatives                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 2026-09-22 | Product name ZanLM (replaces working name "Urai Slide")                                                                                       | Owner's choice                                                                                         | Urai Slide                                           |
| 2026-09-22 | White/navy palette, light theme default, navy dark theme supported                                                                            | Owner's choice during T0 revisions                                                                     | Charcoal/lime; dark as default                       |
| 2026-09-22 | Navbar option A, Floating studio pill                                                                                                         | Owner's explicit choice; best continuity between marketing and work pages                              | B Compact command pill; C Split capsule              |
| 2026-09-22 | Landing animation option (c)                                                                                                                  | Owner wants a lively, animated site with React Bits + GSAP                                             | (a) keep static; (b) storyboard without a background |
| 2026-09-22 | React Bits components are installed only via the official CLI; BlurText kept                                                                  | Existing BlurText is byte-identical to the official registry file                                      | Replacing BlurText                                   |
| 2026-09-22 | Git initialized; previous work committed as a baseline before any change                                                                      | No history existed                                                                                     | Rewriting history per feature                        |
| 2026-09-22 | Code must be formatted with Prettier; no minified source                                                                                      | Previous code was written as long single lines                                                         | Leaving code as-is                                   |
| 2026-09-22 | Tailwind: map tokens to `@theme`; new markup uses Tailwind; legacy CSS migrates only when its component is touched, and migrating is optional | Avoid a risky full rewrite                                                                             | Rewriting all CSS now; dropping Tailwind             |
| 2026-09-22 | Threads as the animated background, on hero and sign-in (half amplitude)                                                                      | Moves on its own, pauses itself offscreen, no global listeners                                         | Dot Grid (static without a pointer), Waves           |
| 2026-09-22 | Threads line color `#B2C5DD` / `#7696BD` (light/dark), opacity 0.40 on canvas and 0.30 on surface (dark 0.36 / 0.30)                          | Highest opacity that keeps muted text at WCAG AA with margin (limits 0.46/0.35 light, 0.425/0.35 dark) | Navy lines (limit 0.125, nearly invisible)           |
| 2026-09-22 | Demo slide scales to 0.9 while separated                                                                                                      | The 36 px text lift otherwise leaves the frame and hits the label above                                | Smaller lift (breaks the storyboard), clipping       |
| 2026-09-22 | Magnet on the hero CTA only                                                                                                                   | In the compact navbar the pull left 2.1 px to the pill edge and broke its silhouette                   | Navbar CTA magnet                                    |

## Known issues

- **Login rate limit is one global bucket** (`createLoginLimiter` in `lib/auth/core.ts`). Anyone can lock sign-in for 60 seconds. Acceptable for loopback-only use; **must be replaced with a per-IP limiter (using a trusted proxy header) before any deploy.**
- There is no `.env.local` yet. The owner runs `npm run setup` in PowerShell themselves. Process environment variables override `.env.local` in Next.js, so stale `ACCESS_CODE`/`SESSION_SECRET` in the Windows environment must be removed first.
- Real-GPU frame rate of Threads was not measured; headless checks used software rendering. Check the Performance panel on the laptop.
- Hidden-tab pausing of Threads relies on its own `document.hidden` check plus the browser pausing `requestAnimationFrame`; only the offscreen pause was measured.
- Threads keeps a `requestAnimationFrame` loop alive while offscreen (it skips the draw); the cost is a no-op callback per frame.
- On desktop the four in-slide labels are briefly visible between server render and hydration before the pinned timeline hides them. No layout shift; opacity only.
- Legacy components still use class-based CSS in `app/globals.css` (see AGENTS.md, Styling).
- `node_modules` contains three extraneous packages (`@img/sharp-wasm32`, `@napi-rs/wasm-runtime`, `@tybys/wasm-util`); harmless, removable with `npm prune`.
- `scripts/setup.mjs` writes the access code in plain text to `.env.local` (needed because the server hashes both sides at compare time). The `0o600` file mode has no effect on Windows; the file is protected only by the user profile ACL and `.gitignore`.
- `npm start` sets Secure cookies, so production mode over plain HTTP cannot sign in; use `npm run dev` locally.

## Next steps

1. Owner answers the five decisions in `docs/T2-plan.md` section 9 and puts a NotebookLM sample into `samples/`. Do not start T2 code before approval.
2. Owner runs `npm run setup` and checks reduced motion with the checklist above.
3. Implement T2 in the commits listed in the plan.
