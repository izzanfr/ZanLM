// Decision logic for the animated background, kept pure so it can be unit tested.

export type BackgroundMode = "pending" | "animated" | "static";

export type BackgroundInputs = {
  /** `prefers-reduced-motion: reduce` is active. */
  reducedMotion: boolean;
  /** WebGL context could be created; null until it has been checked. */
  webgl: boolean | null;
  /** The background has come near the viewport at least once. */
  nearViewport: boolean;
  /** The WebGL component threw while mounting. */
  failed: boolean;
};

/**
 * - static: show the T0 line motif (reduced motion, no WebGL, or a failure).
 * - pending: render nothing yet (not near the viewport or not checked yet).
 * - animated: mount Threads.
 *
 * Reduced motion wins over everything, so no WebGL work starts at all.
 */
export function backgroundMode(inputs: BackgroundInputs): BackgroundMode {
  if (inputs.reducedMotion || inputs.failed || inputs.webgl === false) return "static";
  if (!inputs.nearViewport || inputs.webgl === null) return "pending";
  return "animated";
}
