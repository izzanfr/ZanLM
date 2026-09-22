// Decision logic and constants for the landing layer demo (components/slide-demo.tsx).

/** Media conditions evaluated by gsap.matchMedia(); GSAP re-runs setup when one changes. */
export const DEMO_CONDITIONS = {
  spacious: "(min-width: 1024px) and (min-height: 700px)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
} as const;

export type DemoMotionMode = "pinned" | "enter" | "static";

/**
 * - static: reduced motion; a still separated diagram with labels, no pin, no scrub.
 * - pinned: spacious desktop; three-phase scrubbed storyboard.
 * - enter: everything else; a short, unpinned scrub as the demo enters.
 */
export function demoMotionMode(conditions: {
  spacious: boolean;
  reducedMotion: boolean;
}): DemoMotionMode {
  if (conditions.reducedMotion) return "static";
  return conditions.spacious ? "pinned" : "enter";
}

/** How far each layer lifts in the separated state, in CSS pixels (T0 storyboard: 12/24/36). */
export const SEPARATED_OFFSETS = {
  panels: { x: -8, y: -12 },
  objects: { x: 14, y: -24 },
  text: { x: -6, y: -36 },
} as const;

/** Scale of the reconstructed slide while separated, so the 36 px text lift stays inside the frame. */
export const SEPARATED_SCALE = 0.9;
