import { cn } from "@/lib/utils";

/**
 * The static T0 slide-outline motif: three offset rounded frames.
 * Used as the fallback for the animated background.
 */
export function LineMotif({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "absolute h-[134px] w-[126px] -rotate-[13deg] opacity-[0.36] motion-reduce:rotate-0",
        className,
      )}
    >
      <span className="absolute inset-0 rounded-card border border-border" />
      <span className="absolute inset-0 -translate-x-2.5 -translate-y-2.5 rounded-card border border-border" />
      <span className="absolute inset-0 -translate-x-5 -translate-y-5 rounded-card border border-border" />
    </div>
  );
}
