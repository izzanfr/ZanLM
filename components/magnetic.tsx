"use client";
import type { ReactNode } from "react";
import Magnet from "./reactbits/Magnet";
import { FINE_POINTER_QUERY, MAGNET_SETTINGS, magnetEnabled } from "@/lib/magnet";
import { REDUCED_MOTION_QUERY, useMediaQuery } from "@/lib/use-media-query";

/**
 * Subtle magnetic pull around a call to action. Only the wrapper moves; the
 * focusable link inside keeps its own focus ring. Server render and hydration
 * start disabled, so touch, keyboard and reduced-motion users never see motion.
 */
export function Magnetic({ children, className }: { children: ReactNode; className?: string }) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY, true);
  const finePointer = useMediaQuery(FINE_POINTER_QUERY, false);
  return (
    <Magnet
      disabled={!magnetEnabled({ reducedMotion, finePointer })}
      magnetStrength={MAGNET_SETTINGS.strength}
      padding={MAGNET_SETTINGS.padding}
      activeTransition="transform var(--motion-panel) var(--ease)"
      inactiveTransition="transform var(--motion-page) var(--ease)"
      wrapperClassName={className}
    >
      {children}
    </Magnet>
  );
}
