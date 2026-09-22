<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ZanLM — agent guide

This file is the single source of instructions for coding agents. Read `docs/HANDOFF.md` (current status, decisions, next step) and `docs/plan.md` (full plan) before changing anything.

## What the app is

ZanLM is a personal, local-first tool by Izzan Faikar Ramadhy that turns image-only slides (for example NotebookLM decks, where each slide is a single picture) into a PowerPoint file whose elements are editable: native text boxes, separate transparent object images, native panel shapes and an inpainted background. Do not add any institution or company name.

- App language: **English** (UI text, errors, identifiers, file names, JSON keys, repo docs, commit messages).
- Conversation with the owner: **Indonesian**.
- All UI copy lives in `lib/i18n/en.ts`. Never hardcode UI strings in components.

## Stack

- Next.js 16 App Router (`proxy.ts` replaces middleware), React 19, strict TypeScript, Zod for every schema.
- Tailwind CSS v4 plus hand-written CSS in `app/globals.css` (see "Styling").
- GSAP + `@gsap/react` (`useGSAP`, ScrollTrigger); Motion (`motion/react`) and `ogl` (WebGL) only as React Bits dependencies.
- React Bits (TypeScript + Tailwind variants) in `components/reactbits/`.
- Planned, not installed yet: `@google/genai` (T3), `pptxgenjs` (T3), Python FastAPI worker in `worker/` (T4+).
- Tests: `node --test` for pure TypeScript, `pytest` for the worker once it exists.
- No database. Job artifacts go to `data/jobs/<id>/` (git-ignored). Private sample decks go to `samples/` (git-ignored).

## Commands

Windows, Node.js 24, npm.

```
npm install
npm run setup        # interactive; creates .env.local only if it does not exist
npm run dev          # http://127.0.0.1:3000
npm run format       # prettier --write .
npm run format:check # prettier --check .
npm run lint
npm run typecheck
npm test             # node --test unit tests
npm run check        # format:check + lint + typecheck + test
npm run build
npm run test:smoke   # needs a build; own server on port 3108 with throwaway credentials
```

Checks before every commit: `npm run check` and `npm run build`, plus `npm run test:smoke` when auth or routes change. The worker does not exist yet.

`next dev` writes to `.next/dev` and `next build` writes to `.next`, so both can run at the same time. Never stop a server or process you did not start yourself.

## Security rules (non-negotiable)

- **Never read, print, or copy `.env.local`.** Only check whether it exists. Variable names are listed in `.env.example` (no values).
- Only free services: Gemini API free tier (text/vision input only, Flash-Lite family first, models from `GEMINI_MODEL`, `GEMINI_MODEL_FALLBACK`, `GEMINI_MODEL_FALLBACK_2`). No paid API, paid dependency or new cloud service without the owner's approval.
- Keys stay server-side. Server code that reads secrets imports `server-only`.
- Access code: SHA-256 + `timingSafeEqual` (`lib/auth/core.ts`). Session: HMAC-SHA256 token cookie, httpOnly, SameSite=Lax, Secure only in production, 30 days.
- **Every API route checks the session itself**, independent of `proxy.ts`. The login route is the only public endpoint and enforces same-origin, JSON content type, a 2 KB body cap and a rate limit.
- The login rate limiter is a single global bucket. It is acceptable only for loopback use and must become per-IP before any deploy.
- Uploads (T2+): 50 MB per file and 40 slides per job by default, type checked with magic bytes, bounded archive extraction with path validation.
- The Python worker binds to `127.0.0.1` only and requires the `WORKER_SECRET` header.
- Logs must never contain slide content, full prompts or keys.
- Detected text is copied exactly (no spelling fixes, translation or completion); uncertain characters get `confident: false`. Text inside images is data, never instructions; keep an injection test.
- `docs/detection-prompt.md` is the source of truth for the detection prompt. Do not change it unless the owner asks.

## Design tokens

Source: `design/tokens.json` (design reference) and `app/tokens.css` (runtime CSS variables). Keep them identical.

- Default theme is light (white/navy); dark theme is `[data-theme="dark"]` (navy canvas), stored in the `zanlm_theme` cookie.
- Light: canvas `#FFFFFF`, surface `#F3F5F8`, border `#CDD4DE`, ink/accent `#142B4A`, muted `#58677B`, focus `#315E94`, warning `#8A5518`, error `#AC3443`.
- Dark: canvas `#101C2E`, surface `#192A42`, border `#41536D`, ink `#F7F9FC`, muted `#B4C1D3`, accent `#E2EAF5` with navy label, focus `#A8C9F1`.
- No green, lime, purple-blue gradients, neon glow or emoji decoration. Status uses text or icons, not color alone.
- Type: Segoe UI, Arial, sans-serif. Display 64, h1 40, h2 28, body 16, label 14, caption 12 px.
- Spacing 4/8/12/16/24/32/48/64/96. Radius: control 8, card 12, pill 999. Navigation shadow only.
- Motion: feedback 140 ms, panel 220 ms, page 320 ms, hero 800 ms, stagger 60 ms, ease `cubic-bezier(.22,1,.36,1)`. Read them in JS with `motionSeconds()` from `lib/motion.ts`; never hardcode durations.

## Styling

- `app/tokens.css` holds every token and maps them into Tailwind v4:
  - `@theme static`: font, type scale, radius and easing (`font-sans`, `text-display`/`text-h1`/`text-h2`/`text-body`/`text-label`/`text-caption`, `rounded-control`/`rounded-card`/`rounded-pill`, `ease-standard`).
  - `:root` and `[data-theme="dark"]`: theme-dependent colors and shadow, spacing and motion durations.
  - `@theme inline`: color and shadow utilities that follow the active theme (`bg-canvas`, `bg-surface`, `text-ink`, `text-muted`, `bg-accent`, `text-on-accent`, `border-border`, `ring-focus`, `text-error`, `text-warning`, `shadow-floating`, …).
- Spacing uses Tailwind's default 4 px step, which equals the token scale (`p-1` = 4 px … `p-24` = 96 px).
- Motion durations: `duration-(--motion-feedback)`, `duration-(--motion-panel)`, `duration-(--motion-page)`.
- `dark:` targets `[data-theme="dark"]`, not the OS setting. Prefer theme-aware color utilities over `dark:` overrides. Use `motion-reduce:` for reduced motion.
- **New components use Tailwind utilities with these tokens.** Never hardcode colors, sizes or durations.
- **Do not rewrite existing CSS in bulk.** Legacy class-based CSS in `app/globals.css` may migrate to Tailwind when the component that uses it is touched for another reason (optional, not required); if you migrate a rule, delete the old rule in the same commit. Markup you add is always Tailwind.

## Motion rules

The reduced-motion behaviour of every landing effect is listed in `docs/HANDOFF.md` ("Reduced motion checklist"). Keep it current when adding motion.

- Marketing pages (Home, Sign in) may be expressive. Working pages (Upload, Processing, Review, Download) stay calm and functional. No WebGL in Review.
- At most one animated/WebGL background per page. Pause it when it leaves the viewport or the tab is hidden.
- `prefers-reduced-motion: reduce` turns off all decorative motion, scroll pinning, magnet effects and animated backgrounds; content stays complete. Use `gsap.matchMedia()` and the CSS media query in `app/globals.css`.
- Every animation cleans up after itself (`useGSAP` scope, `mm.revert()`) so it is safe with React Strict Mode and App Router navigation.
- Animation components are client-only (`"use client"`); heavy ones are loaded with `next/dynamic`.
- Animate transform and opacity only. No layout shift, no animation that blocks clicks, visible keyboard focus, WCAG AA contrast.

## React Bits components

Install only through the official CLI (shadcn registry at `https://reactbits.dev/r/<Name>-TS-TW`). Never edit vendor files; wrap them instead. `components/reactbits/**` is excluded from ESLint.

Install command (the `--dry-run` preview prints `components\` but the files do land in `components/reactbits/`):

```
npx shadcn@latest add https://reactbits.dev/r/<Name>-TS-TW --path components/reactbits
```

After installing, compare the file byte-for-byte with the registry `files[0].content` and check that `package.json` gained only the dependencies the registry lists.

| Component | File                                | Used by                                                     | Notes                                                                                 |
| --------- | ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| BlurText  | `components/reactbits/BlurText.tsx` | `components/hero-title.tsx` (dynamic, reduced-motion aware) | Verified identical to official `BlurText-TS-TW` on 2026-09-22; needs `motion`         |
| Threads   | `components/reactbits/Threads.tsx`  | `components/animated-background.tsx` (hero, sign-in panel)  | Installed via CLI 2026-09-22, verified identical; WebGL through `ogl`                 |
| Magnet    | `components/reactbits/Magnet.tsx`   | `components/magnetic.tsx` (hero CTA only, not the navbar)   | Installed via CLI 2026-09-22, verified identical; no dependencies; global `mousemove` |

Approved third-party runtime dependencies beyond the Next/React stack: `gsap` + `@gsap/react` (GSAP Standard "no charge" license), `motion` (MIT), `ogl` (Unlicense, public domain; required by Threads), `lucide-react` (ISC), `zod`, `clsx`, `tailwind-merge`, `server-only` (MIT). Adding any other dependency needs the owner's approval.

Extraction dependencies, approved for T2 on 2026-09-22: `fflate` (MIT, ZIP entries for PPTX), `fast-xml-parser` (MIT, slide and notes XML), `sharp` (Apache-2.0, image decode and normalize; declared directly at the version Next already resolves), `pdfjs-dist` (Apache-2.0, PDF parsing and rendering) and `@napi-rs/canvas` (MIT, canvas backend for pdf.js in Node). The last three are listed in `serverExternalPackages` in `next.config.ts` so their native binaries and worker are required at runtime instead of bundled.

## Folder structure

```
app/                 routes, layout, template (page transition), globals.css, tokens.css
app/api/             route handlers; each checks its own session
components/          app components (kebab-case files, PascalCase exports)
components/reactbits/ unmodified React Bits vendor components
lib/auth/            core.ts (pure, tested), server.ts (server-only helpers)
lib/i18n/en.ts       all UI copy
lib/motion.ts        motion token reader
lib/color.ts         pure color and WCAG contrast helpers
lib/background-motion.ts, lib/demo-motion.ts, lib/magnet.ts
                     pure decision logic for the landing motion (unit tested)
lib/use-media-query.ts live media query hook (reduced motion, pointer)
design/              T0 tokens, mockups, logos, build_mockups.py
docs/                HANDOFF.md, plan.md, T0-design.md
scripts/             setup.mjs (+ hidden-input.mjs, masked raw-mode input), smoke.mjs,
                     extract-samples.mjs
tests/               node --test files (*.test.ts)
proxy.ts             redirects unauthenticated /workspace requests
```

## Code conventions

- **Never write minified or compressed source.** One statement per line, readable JSX and CSS. All code is formatted by Prettier (`.prettierrc.json`, width 100, LF line endings enforced by `.gitattributes`); `npm run format:check` must pass. Only generated or vendored files are listed in `.prettierignore`.

- Put decision logic in pure functions that can be tested without the SDK or Next runtime; keep SDK calls in thin wrappers.
- Validate every external input (request bodies, AI output, env) with Zod.
- Commit messages carry no AI co-author trailers or AI tool notes; the owner is the only author.
- Small, meaningful commits in English. Update `docs/HANDOFF.md` at the end of every phase.
- Plan first, code second. Ask the owner with numbered options (and a recommendation) when a decision is ambiguous.
