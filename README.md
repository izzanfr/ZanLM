# ZanLM

A personal workspace by Izzan Faikar Ramadhy for rebuilding image-based slides as editable PowerPoint elements.

## Current release

T1 foundation: landing page, interactive illustrative layer demo, light/dark themes, access-code login, signed sessions and a protected workspace. **File upload, AI detection and PowerPoint export are not implemented yet.** The demo does not process files.

## Run locally on Windows

Use Node.js 24 LTS and npm.

```powershell
npm install
npm run setup
npm run dev
```

Open http://127.0.0.1:3000. Setup asks for your own access code without echoing it and generates session/worker secrets. It creates `.env.local` only if that file does not exist; it never reads or overwrites it. Do not share, commit, print, or ask an agent to read that file. No Gemini key is needed for T1.

Alternatively, create `.env.local` yourself using the variable names in `.env.example`. `ACCESS_CODE` must be at least 8 characters; use 12 or more. `SESSION_SECRET` must be a random value of at least 32 characters. Restart the server after changing configuration. Without configuration, the public landing still works and sign-in shows setup guidance; there is no default password or bypass.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:smoke
npm start
```

`test:smoke` requires a production build, uses port 3108, creates ephemeral credentials in the child process environment, and shuts down its own server. It never reads your environment file. Development and production servers bind to loopback only. A production server sets Secure cookies and expects HTTPS for normal browser use; use `npm run dev` for local HTTP sign-in.

## Architecture

- Next.js 16 App Router, strict TypeScript, React, Tailwind CSS v4.
- English copy: `lib/i18n/en.ts`.
- Runtime design/motion tokens: `app/tokens.css`; approved design reference: `design/`.
- GSAP/useGSAP and ScrollTrigger; unmodified React Bits TS + Tailwind BlurText behind a reduced-motion-aware dynamic wrapper.
- SHA-256/timingSafeEqual access-code comparison; HMAC-SHA256 signed 30-day sessions. HttpOnly, SameSite=Lax, Secure only in production.
- Every protected API checks its own session. Login is the intentional public credential-exchange endpoint, with strict body validation, a 2 KB stream cap, same-origin checks, and a bounded single-user rate limiter.
- No slide content, credentials, or full prompts are logged by application code.
- Stateless logout removes the browser cookie. Rotating SESSION_SECRET invalidates all issued tokens; individual server-side revocation is not implemented.

The future Python worker is isolated under `worker/` and will bind only to 127.0.0.1, require WORKER_SECRET, and support GPU/CPU. It is **not implemented** in T1. There is no database. Future job artifacts belong in ignored `data/jobs/<id>/`; private test decks belong in ignored `samples/`.

See `docs/HANDOFF.md`, `docs/plan.md`, and `docs/T0-design.md` for the phase boundary and next steps.
