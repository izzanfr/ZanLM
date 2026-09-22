# T1 motion plan

Status: **implemented** (commits `6f94194`, `f67c345`, `e492868`, `6c45cea`). Approved on 2026-09-22 with Threads. Deviations from the text below, recorded in `docs/HANDOFF.md`: `ogl` is Unlicense (not MIT); the separated slide scales to 0.9; the magnet is on the hero CTA only; the static fallback is also used when WebGL is missing or fails; the CLI dry-run preview shows the wrong target folder but installs to `components/reactbits/`.

Scope: landing option (c) approved on 2026-09-22. This plan covers the animated background, the pinned layer demo and the magnetic CTA. Nothing here is implemented until the owner approves it and picks a background.

## 1. Animated background: two options

Candidates were checked against the official registry (`https://reactbits.dev/r/<Name>-TS-TW.json`) on 2026-09-22.

|                      | Option 1: Threads (recommended)                                           | Option 2: Dot Grid                                                                 |
| -------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Look                 | Thin flowing lines that drift slowly; can be tinted navy at low amplitude | Regular dot grid; dots near the pointer brighten, a click sends a small shock wave |
| Motion without input | Yes, continuous and slow                                                  | No; static until the pointer moves, so static on touch devices                     |
| Renderer             | WebGL via `ogl`                                                           | Canvas 2D, uses GSAP InertiaPlugin                                                 |
| New dependency       | `ogl` (Unlicense)                                                         | none (`gsap` already installed)                                                    |
| Built-in pausing     | Skips work when offscreen (IntersectionObserver) or `document.hidden`     | None; redraws every frame while mounted                                            |
| Global listeners     | none (mouse on its container only, and we disable it)                     | `mousemove` and `click` on `window`                                                |
| Fit with white/navy  | Good: navy lines on white, pale blue lines on navy                        | Good: reads like a slide canvas grid                                               |

Rejected: Waves (continuous canvas lines, 400 lines of code, global `touchmove` listener), Aurora/Silk/Iridescence/Particles/Light Rays (glow or gradient look the T0 direction rules out; Silk adds `three` and React Three Fiber).

Recommendation: **Threads for both the hero and Sign in**, with a lower amplitude on Sign in so the form stays calm. It is the only candidate that moves on its own, already pauses itself, and needs no global listeners.

### Wrapper (`components/animated-background.tsx`)

Vendor files stay untouched; a wrapper adds everything the vendor code lacks:

- Client-only, loaded with `next/dynamic` (`ssr: false`), absolutely positioned behind content, `aria-hidden`, `pointer-events: none`, fixed-size container so there is no layout shift.
- Renders nothing when `prefers-reduced-motion: reduce` is active (live, via `useSyncExternalStore`), when WebGL is unavailable, or before the element first nears the viewport.
- Pausing: Threads skips frames offscreen or in a hidden tab (verified in its source). If Dot Grid is chosen, the wrapper unmounts it when it leaves the viewport or the tab is hidden, because it has no pause of its own.
- Color comes from theme tokens (new `--background-motion` token per theme), re-read when `data-theme` changes, so dark mode gets pale lines on navy.
- Opacity is capped so hero text keeps WCAG AA contrast; verified by measuring text and background colors.
- Mouse interaction disabled for Threads (calmer, no pointer tracking).
- Pure decision logic (`shouldAnimateBackground(reducedMotion, webgl, inView, hidden)`) is exported and unit-tested.

## 2. Pinned layer demo

Implements the T0 storyboard in `components/slide-demo.tsx` with `useGSAP` + ScrollTrigger + `gsap.matchMedia()`.

| Condition                                                                                 | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `(min-width: 1024px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)` | Section pins for about 150% of the viewport height with a scrubbed timeline: **Separate** 0–35% (panels lift 12 px, objects 24 px, text 36 px, slight lateral offset); **Explain** 35–70% (four labels fade in next to their layers: Rebuilt background, Native shape, Image object, Text box; copy already in `lib/i18n/en.ts`); **Reassemble** 70–100% (layers settle, selection corners appear, final comparison persists). |
| Smaller screens, motion allowed                                                           | No pinning. A short scrub as the demo enters; labels shown statically below the slide.                                                                                                                                                                                                                                                                                                                                         |
| Reduced motion                                                                            | No pin and no scrub. A static exploded view with labels and the before/after comparison, per T0.                                                                                                                                                                                                                                                                                                                               |

- Transform and opacity only; captions and labels are real DOM text, so nothing is conveyed by movement alone.
- The manual controls (layer toggles and Separate/Reassemble) stay. They animate an inner element so they never fight the scroll timeline (existing pattern).
- Cleanup through `useGSAP` scope and `mm.revert()`; `ScrollTrigger.refresh()` after fonts load to avoid pin jumps.

## 3. Magnetic CTA

- React Bits **Magnet** (no dependencies), wrapped by `components/magnetic.tsx`.
- Applied to the hero "Convert a deck" button and the navbar CTA.
- Disabled when reduced motion is active or the pointer is coarse (`(hover: none)`), so touch and keyboard users get the normal button. Small pull (`padding` about 40 px, low strength); transitions use the motion tokens.
- The focus ring stays on the real link, not on the moving wrapper.

## 4. Installation through the official CLI

```
npx shadcn@latest add https://reactbits.dev/r/Threads-TS-TW --path components/reactbits
npx shadcn@latest add https://reactbits.dev/r/Magnet-TS-TW --path components/reactbits
```

(Dot Grid instead of Threads if option 2 is chosen.) Each command is run with `--dry-run` first to confirm the target paths and dependency changes (`--path` and `--dry-run` confirmed in `shadcn add --help` on 2026-09-22). After installing, each file is compared byte-for-byte with the registry content, and `package.json` is checked so only the expected dependency (`ogl`) was added. The existing BlurText is already byte-identical to the official `BlurText-TS-TW` and stays.

## 5. Commits and verification

1. `chore: add React Bits Threads and Magnet via CLI` (vendor files unchanged)
2. `feat: add animated hero and sign-in background`
3. `feat: pin the layer demo with label and reassembly phases`
4. `feat: add magnetic main CTA`
5. `docs: close T1` (HANDOFF, AGENTS React Bits table)

Each commit: `npm run check`, `npm run build`, `npm run test:smoke`. Browser checks at 375, 768, 1024 and 1440 px in light and dark themes: no horizontal scroll, no layout shift, pin starts and ends cleanly, background pauses offscreen (frame counter), one WebGL canvas per page at most, CTA focus visible. Reduced motion is verified through the unit-tested decision function and, if the browser tooling allows it, by emulating the media query; otherwise this is reported as not visually verified.
