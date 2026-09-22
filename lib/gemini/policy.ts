/**
 * What to do after one Gemini call, decided from the outcome alone. Pure: no
 * SDK, clock or network, so every rule in docs/T3-plan.md section 3.2 is
 * covered by tests/gemini-policy.test.ts.
 */

export type Outcome = "ok" | "429" | "503" | "timeout" | "invalid-response" | "error";

export type FailReason =
  "quota-exhausted" | "unavailable" | "deadline" | "invalid-response" | "error";

export type Step =
  | { action: "done" }
  | { action: "next-tier"; tier: number }
  | { action: "retry"; tier: number; afterMs: number }
  | { action: "fail"; reason: FailReason };

export type PolicyState = {
  /** Index of the tier that produced `outcome`, 0-based. */
  tier: number;
  tierCount: number;
  outcome: Outcome;
  /** The single retry of a final-tier 503 has already been used. */
  retriedFinal503: boolean;
  elapsedMs: number;
  deadlineMs: number;
  /** Time one more request may take; used to refuse a step that cannot finish. */
  requestTimeoutMs: number;
};

export const FINAL_503_RETRY_MS = 4000;

export function nextStep(state: PolicyState): Step {
  const { outcome, tier, tierCount } = state;
  if (outcome === "ok") return { action: "done" };
  // Another model will not fix a bad key or a malformed request.
  if (outcome === "error") return { action: "fail", reason: "error" };

  const last = tier >= tierCount - 1;
  const remaining = state.deadlineMs - state.elapsedMs;

  if (!last) {
    // Moving on only helps if the next request can finish before the deadline.
    if (remaining < state.requestTimeoutMs) return { action: "fail", reason: "deadline" };
    return { action: "next-tier", tier: tier + 1 };
  }

  if (outcome === "429") return { action: "fail", reason: "quota-exhausted" };
  if (outcome === "invalid-response") return { action: "fail", reason: "invalid-response" };
  if (outcome === "timeout") return { action: "fail", reason: "unavailable" };

  // A 503 on the last tier gets exactly one more try, four seconds later.
  if (state.retriedFinal503) return { action: "fail", reason: "unavailable" };
  if (remaining < FINAL_503_RETRY_MS + state.requestTimeoutMs) {
    return { action: "fail", reason: "deadline" };
  }
  return { action: "retry", tier, afterMs: FINAL_503_RETRY_MS };
}

/** The configured chain, with empty entries skipped and duplicates removed. */
export function modelChain(values: ReadonlyArray<string | undefined>): string[] {
  const chain: string[] = [];
  for (const value of values) {
    const model = value?.trim();
    if (model && !chain.includes(model)) chain.push(model);
  }
  return chain;
}
