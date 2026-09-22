# ZanLM handoff

Last updated: 2026-09-22. Read `AGENTS.md` first; the full plan is in `docs/plan.md`.

## Phase status

| Phase | Status | Last commit | Notes |
| --- | --- | --- | --- |
| T0 Design | Done | `84e844f` | Tokens, six mockups, three navbar options, storyboard and logo in `design/` and `docs/T0-design.md`. Navbar A chosen by the owner. |
| T1 Foundation | In progress | `84e844f` | Auth, sessions, proxy, API guards, i18n dictionary, navbar, page transition and a first landing are done. Remaining: see "Next steps". |
| T2 Upload and extraction | Not started | — | |
| T3 Gemini detection and text export | Not started | — | |
| T4 Worker and text inpainting | Not started | — | |
| T5 Object segmentation | Not started | — | |
| T6 Native panel shapes | Not started | — | |
| T7 Review and fix, QA | Not started | — | |
| T8 Tables and SVG icons (optional) | Not started | — | |

History note: the previous agent (ChatGPT) built T0 and most of T1 without git and stopped without a handoff. Commit `84e844f` is that work imported as-is. An audit on 2026-09-22 verified: lint, typecheck, 7 unit tests, production build and 22 HTTP smoke checks pass; navbar compact/hide/show on scroll and the mobile menu (stagger, focus return, scroll lock) work in a browser. Dark mode and reduced motion were checked in code only, not visually.

## Verified T1 features

- Access-code login with SHA-256 + `timingSafeEqual`, HMAC-SHA256 30-day session cookie (`lib/auth/core.ts`, unit tested).
- `proxy.ts` redirects `/workspace` without a session. Every API route (`app/api/**`) checks the session itself.
- Login endpoint: same-origin check, JSON only, 2 KB stream cap, strict Zod body, global rate limit (10 per minute).
- Logout clears the cookie. Rotating `SESSION_SECRET` invalidates every session; there is no per-session revocation.
- All UI copy in `lib/i18n/en.ts`.
- Floating pill navbar (option A): compacts after 48 px, hides on downward scroll, returns on upward scroll, stays visible on focus; GSAP active marker; native `<dialog>` mobile menu.
- Page transition in `app/template.tsx` (GSAP, reduced-motion aware).
- Landing: BlurText hero, illustrative layer demo with light ScrollTrigger scrub and manual layer toggles, how-it-works, limitations disclosure, CTA.
- Light/dark theme toggle with cookie.

## Decision log

| Date | Decision | Reason | Rejected alternatives |
| --- | --- | --- | --- |
| 2026-09-22 | Product name ZanLM (replaces working name "Urai Slide") | Owner's choice | Urai Slide |
| 2026-09-22 | White/navy palette, light theme default, navy dark theme supported | Owner's choice during T0 revisions | Charcoal/lime; dark as default |
| 2026-09-22 | Navbar option A, Floating studio pill | Owner's explicit choice; best continuity between marketing and work pages | B Compact command pill; C Split capsule |
| 2026-09-22 | Landing animation option (c): full storyboard demo (pinned on desktop, label phase, reassembly phase), one subtle animated React Bits background in the hero (optionally Sign in), magnet or spotlight effect on the main CTA | Owner wants a lively, animated site with React Bits + GSAP | (a) keep static; (b) storyboard without a background |
| 2026-09-22 | React Bits components are installed only via the official CLI; BlurText kept | Existing BlurText is byte-identical to the official `BlurText-TS-TW` registry file | Replacing BlurText |
| 2026-09-22 | Git initialized; previous work committed as a baseline before any change | No history existed | Rewriting history per feature |
| 2026-09-22 | Code must be formatted with Prettier; no minified source | Previous code was written as long single lines | Leaving code as-is |
| 2026-09-22 | Tailwind: map design tokens to `@theme`; new components use Tailwind; legacy CSS migrates only when its file is touched | Avoid a risky full rewrite | Rewriting all CSS now; dropping Tailwind |

## Known issues

- **Login rate limit is one global bucket** (`createLoginLimiter` in `lib/auth/core.ts`). Anyone can lock sign-in for 60 seconds. Acceptable for loopback-only use; **must be replaced with a per-IP limiter (using a trusted proxy header) before any deploy.**
- There is no `.env.local` yet. The owner will run `npm run setup` themselves. Process environment variables override `.env.local` in Next.js, so stale `ACCESS_CODE`/`SESSION_SECRET` in the Windows environment must be removed first.
- Landing motion is below the approved storyboard: no pinned demo, no label or reassembly phase, no animated background, CTA has only a tonal hover.
- Source files are minified single lines (fixed by the Prettier commit that follows this document).
- Tailwind is installed but tokens are not mapped to `@theme` and utilities are barely used.
- Dark mode and reduced motion have no automated or visual verification yet.
- `node_modules` contains three extraneous packages (`@img/sharp-wasm32`, `@napi-rs/wasm-runtime`, `@tybys/wasm-util`); harmless, removable with `npm prune`.
- `npm start` sets Secure cookies, so production mode over plain HTTP cannot sign in; use `npm run dev` locally.

## Next steps

1. Prettier: add `.prettierrc`, `.prettierignore`, `.gitattributes` (LF), `format` and `format:check` scripts; format the code in one behavior-neutral commit; add `format:check` to the checks.
2. Map design tokens to Tailwind `@theme` in `app/globals.css` and document it.
3. Write the T1 animation plan (two background options, pinned demo, CTA effect, CLI install) and wait for owner approval.
4. Implement the approved animation work, verify reduced motion and dark mode in a browser, then close T1.
5. Write the T2 plan (upload, PPTX/PDF/PNG/JPG extraction, Processing page without AI) and wait for approval.
