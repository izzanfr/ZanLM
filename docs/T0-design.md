# ZanLM — T0 design proposal

Status: **approved**. On 2026-09-22 the owner confirmed navbar **option A (Floating studio pill)**, the product name **ZanLM**, and the **white/navy palette with light theme as default**. The landing motion was later upgraded to option (c); see "Approval record" at the end and `docs/HANDOFF.md`. Sections below keep the original proposal text for reference.
Author credit: Izzan Faikar Ramadhy. Product UI and repository documentation are English; user discussion is Indonesian.

## Direction and identity

Revision 2 follows the user's white/navy direction. White is the primary canvas, deep navy anchors typography and primary actions, and pale blue-gray separates work areas. Color is reserved for meaningful status feedback. No lime, charcoal-green, neon glow, decorative gradient, or oversized ambient effect. The design relies on typography, whitespace, fine rules, and an actual slide transformation demo. The UI/UX search still matches a product-demo-led layout; the palette is a deliberate user-directed design choice.

The original logo combines a Z with a thin slide frame and a detached upper-right square representing an extracted editable object. The square is the only extra accent; everything stays navy/white. `design/zanlm-mark.svg` is the transparent mark; `design/zanlm-icon.svg` is the app tile; `design/zanlm-logo.svg` and `design/zanlm-logo-inverse.svg` are wordmarks. Use the full mark at 24 px or larger; 16 px favicon treatment remains to be tested. Clear space: at least one square width.

## Tokens

The single proposed token source is `design/tokens.json`. Default theme: light. Canvas #FFFFFF; surface #F3F5F8; border #CDD4DE; primary text and action #142B4A; secondary text #58677B; white text on navy buttons. Success uses navy with a check and label; warning uses ochre #8A5518 and errors use red #AC3443. No green remains in any mockup, sample slide, selection outline or status token. Focus #315E94. Borders organize areas; focus indicators use higher contrast.

Dark mode remains required: navy canvas #101C2E, surface #192A42, off-white text #F7F9FC, muted text #B4C1D3, and pale blue actions #E2EAF5 with navy labels. See `design/dark-mode.svg`; dark mode is optional rather than the default.

Typography: Segoe UI with Arial/system fallback. Display 64, page heading 40, section heading 28, body 16, labels 14, captions 12 px. Headline tracking is slightly tight; body copy is neutral and direct. Mockups are scaled compositions, not production CSS measurements. Spacing 4/8/12/16/24/32/48/64/96 px. Control radius 8, card 12; pill navigation retains its requested silhouette. Shadow: 0 8px 28px rgba(20,43,74,0.07), reserved for navigation.

Motion: feedback 140 ms; panels 220 ms; route transitions 320 ms; hero 800 ms; stagger 60 ms; ease cubic-bezier(0.22,1,0.36,1). Exit runs faster than entry. Reduced motion removes decorative motion, scroll pinning, magnetism and exploded transitions; functional state changes remain effectively immediate.

## Six screen mockups

Open `design/screens.svg` for the full board. Individual SVGs retain readable desktop compositions.

1. Home: floating navigation, two-line editorial headline, conversion CTA, visual before/after, three-step workflow, honest limitations and final CTA. Full production landing expands the compact mockup into scroll sections.
2. Sign in: identity illustration beside a labeled access-code form, inline error and persistent keyboard focus. Submission has pending feedback; invalid code receives a brief 4 px shake only when motion is allowed.
3. Upload: drag-and-drop and equivalent Browse files button, explicit file/slide caps, upload validation beside the input, data disclosure and worker readiness. Local processing does not mean offline: slide images go to Gemini for detection.
4. Processing: per-slide stage and job progress, connected device details, optional provider quota only when actually available, cancellation and actionable failures. Never invent remaining quota, VRAM, elapsed estimates or successful processing.
5. Review: slide strip, original/reconstructed view, optional comparison slider, layer toggles, element inspector, type/text/geometry corrections and object-cut method, reprocess and export. Background is an explicit keep-in-background disposition, not a fabricated detection element type. Save state and pending reprocessing must be visible. Poor masks and uncertain OCR receive text badges as well as color.
6. Download: real job counts, per-slide expandable summary, original-reference checkbox, download, back-to-review and another-conversion controls. Export failures remain retryable.

## Navbar options

See `design/navbar-options.svg`.

- A — Floating studio pill (recommended): wordmark, Home / How it works / Workspace, and Convert a deck. Best continuity across marketing and work pages.
- B — Compact command pill: wordmark, Workspace dropdown, expandable Menu. More canvas space, lower navigation discoverability.
- C — Split capsule: separate brand, link and CTA pills. More expressive, consumes more width.

All variants shrink after 48 px scroll, hide on intentional downward scroll and return upward. Navigation stays visible while focused, during open mobile menus, and near the top. Active capsule moves in 220 ms. The solid logo shifts upward 1 px on hover. CTA uses a small tonal change; touch and keyboard users receive equivalent focus feedback.

On mobile, variants converge to brand + labeled Menu button, then a full-width menu with 60 ms stagger. Escape closes it, focus is trapped while modal and restored to the trigger. Minimum targets 44 x 44 px. Nav is not allowed to obscure focused content.

## Landing storyboard

| Beat | Trigger | Visual | Timing / fallback |
| --- | --- | --- | --- |
| Establish | Page entry | Pill fades in; headline rises 12 px in two word groups | 800 ms total, 60 ms stagger; static when reduced motion |
| Reveal | Hero visible | A fine slide-outline motif on white; no glow or gradient | One decorative background maximum; paused offscreen or hidden |
| Flattened | Demo enters viewport | One intact example slide and Original label | Fully readable before animation |
| Separate | Scroll progress 0–35% | Background stays; panels lift 12 px; objects 24 px; text 36 px | Transform/opacity only; bounded pinned scene on spacious desktop |
| Explain | Scroll progress 35–70% | Labels identify native text, image objects, shapes and rebuilt background | Captions remain visible independently of movement |
| Reassemble | Scroll progress 70–100% | Layers settle beside the original; selection boxes reveal editable parts | Final comparison persists; replay optional |
| Continue | Demo exits | Three-step workflow, limitations and final conversion CTA | No pinning on narrow/mobile layouts |

Reduced-motion users receive a static exploded diagram plus before/after comparison. Do not rely on movement to communicate any capability. Planned GSAP implementation uses useGSAP cleanup and matchMedia. A React Bits component will be verified against its official registry before selection/install in T1; none has been installed or claimed verified in T0.

## Responsive and accessibility behavior

Validate at 375, 768, 1024 and 1440 px during implementation. At 375 px the hero stacks, sign-in illustration shrinks, upload remains full-width and progress cards wrap. Review offers Original / Reconstructed tabs instead of cramped side-by-side images, with an inspector drawer and horizontally scrollable slide thumbnails. Comparison slider has a keyboard-operable range control. Drag/resize has numerical X/Y/W/H alternatives. Layer toggles are labeled checkboxes. Job events use a restrained live region. Errors are associated with their fields. Focus ring uses a contrast-tested blue with an offset; statuses include text/icons. No hover-only functionality.

## Product honesty

Use these English limitations in the app:
- Illustrations are editable image objects, not editable artwork.
- Decorative fonts are substituted. Glow, emboss, and gradient text effects are lost.
- Repaired background areas are inferred and may differ from the original.
- Glowing or particle-heavy object edges may need cleanup.

“Free tier” is not an unlimited-service promise. Model availability and quotas must be verified when implementing the provider adapter. Credentials remain server-side. GPU/VRAM will be checked with nvidia-smi when implementing the worker, not assumed from the requested laptop model.

## Review gate

The supplied project brief explicitly requests T0 approval before writing application code. Approve one navbar (recommended A) and the visual direction, or list revisions. After approval, T1 implements the framework, authentication, centralized English copy, landing/navigation/motion and required handoff files. Conversion functionality comes in T2–T7 and must not be presented as already working.

## Validation

SVG artifacts are parsed as XML; tokens parse as JSON. Token text contrast ratios are checked programmatically. No live UI, auth, conversion, sample-file metrics, lint or production build exist at T0. Runtime, responsive, keyboard and motion validation remain T1 work.

## Revision log

2026-09-22 — Replaced charcoal/lime with white/navy at the user’s request. Simplified the logo from separated layers to a solid Z. Updated all six screens, navigation alternatives, tokens, and motion direction. Added inverse logo, app icon and a navy dark-mode preview. Navbar selection and full T0 approval remain pending; this revision does not start application implementation.

## Revision 3 — simplified content and geometry

2026-09-22 — Added a slide frame and detached element to the logo. Removed every legacy green from sample content and selection boxes, not just application chrome. Rebuilt six desktop mockups on a 1200 x 800 canvas with 64 px side margins and consistent 24 px component gaps. Both before/after images now share the exact 640 x 360 source composition scaled uniformly. Slide text occupies the left half; the isolated abstract object occupies the right third. Review has two equal 364 x 204.75 previews and a 296 px inspector. Numerical fields align in two equal columns.

Copy policy: one heading, at most one supporting sentence, and a clear action per area. Remove decorative slogans, technical method lists and repeated explanations. Keep file limits, data disclosure, actionable errors and meaningful status visible. Put full limitations behind What to expect / View limitations; inspector shows cut-method choices only for selected image objects. The source-preservation, font substitution, lost text-effects, inferred-background and imperfect-edge disclosures in Product honesty remain required in that disclosure. These SVGs depict the collapsed default state; they are not interactive controls.

Visual QA: inspected browser-rendered full-page screenshots of all six screens and a larger Review view. Tightened board row spacing after spotting a label encroaching on the previous row. XML parsing and a legacy-green scan pass. No application implementation or conversion tests are claimed. Regenerate mockups with `python -X utf8 design/build_mockups.py`.

## Logo spacing refinement

The user accepted the mockup direction and requested balanced internal logo spacing. The Z now occupies x=20..44 and y=22..44 inside the frame inner bounds x=10..54 and y=12..54: exactly 10 units of clearance on each side, measured against the straight frame edges. The detached square and frame remain unchanged. All logo variants and mockups are regenerated from the shared mark definition.

## Approval record

2026-09-22 — The owner explicitly approved:

- Navbar option A, Floating studio pill (B and C rejected).
- Product name ZanLM and the white/navy palette with the light theme as default; the navy dark theme stays supported.
- Landing motion option (c), which extends the storyboard above: the "separate" demo is pinned on spacious desktop layouts and includes the label and reassembly phases; one subtle animated React Bits background in the hero (optionally also on Sign in) that fits the palette, pauses offscreen or in a hidden tab, and is off under reduced motion; a magnet or spotlight effect on the main CTA. This replaces the earlier "fine slide-outline motif" and "small tonal change" CTA decisions. The detailed plan needs owner approval before implementation.
