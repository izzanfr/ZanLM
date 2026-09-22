"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { backgroundMode } from "@/lib/background-motion";
import { parseHex, toUnitRgb } from "@/lib/color";
import { REDUCED_MOTION_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { ErrorBoundary } from "./error-boundary";

// Vendor component, unmodified. Loaded only on the client and only when needed.
const Threads = dynamic(() => import("./reactbits/Threads"), { ssr: false });

const variants = {
  hero: { amplitude: 1, opacity: "var(--background-motion-opacity)" },
  panel: { amplitude: 0.5, opacity: "var(--background-motion-opacity-surface)" },
} as const;

/**
 * Creates and immediately releases a throwaway context, so a missing or blocked
 * WebGL is detected before ogl runs (ogl logs a console error on failure).
 */
function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function readLineColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--background-motion").trim();
}

/**
 * Decorative Threads background with the T0 line motif as fallback.
 *
 * The parent must be positioned and create a stacking context (`relative isolate`).
 * Threads pauses its own rendering offscreen and in hidden tabs; this wrapper adds
 * lazy mounting, reduced-motion and WebGL fallbacks, and theme-aware color.
 */
export function AnimatedBackground({
  variant,
  fallback,
}: {
  variant: keyof typeof variants;
  fallback: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY, true);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [failed, setFailed] = useState(false);
  const lineColor = useSyncExternalStore(subscribeToTheme, readLineColor, () => "");

  useEffect(() => {
    const element = ref.current;
    if (reducedMotion || nearViewport || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setWebgl(supportsWebGL());
        setNearViewport(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [reducedMotion, nearViewport]);

  const mode = backgroundMode({ reducedMotion, webgl, nearViewport, failed });
  const rgb = parseHex(lineColor);
  const settings = variants[variant];

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {mode === "static" && fallback}
      {mode === "animated" && rgb && (
        <ErrorBoundary onError={() => setFailed(true)}>
          <FadeIn opacity={settings.opacity}>
            <Threads
              color={toUnitRgb(rgb)}
              amplitude={settings.amplitude}
              distance={0}
              enableMouseInteraction={false}
            />
          </FadeIn>
        </ErrorBoundary>
      )}
    </div>
  );
}

function FadeIn({ opacity, children }: { opacity: string; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      className="h-full w-full transition-opacity duration-(--motion-hero) ease-standard [mask-image:linear-gradient(to_right,transparent,black_12%,black_82%,transparent)]"
      style={{ opacity: shown ? opacity : 0 }}
    >
      {children}
    </div>
  );
}
