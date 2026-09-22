// Settings and decision logic for the magnetic CTA (components/magnetic.tsx).

/**
 * React Bits Magnet moves the element by (cursor distance / strength) while the
 * cursor is within `padding` px of it. Strength 12 with padding 32 keeps the pull
 * subtle: about 10 px at most for the hero button.
 */
export const MAGNET_SETTINGS = { strength: 12, padding: 32 } as const;

/** Only fine pointers that can hover get the effect; reduced motion turns it off. */
export function magnetEnabled(input: { reducedMotion: boolean; finePointer: boolean }): boolean {
  return input.finePointer && !input.reducedMotion;
}

export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
