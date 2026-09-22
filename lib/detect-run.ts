/**
 * Guards for `npm run test:detect`: a cap on real requests per item and a time
 * budget for the whole run. Kept apart from the script so both are tested
 * with a fake Gemini call in tests/detect-run.test.ts.
 */
import type { Cache } from "./gemini/cache.ts";
import type { CallResult, GeminiCall, MediaResolutionChoice } from "./gemini/client.ts";
import {
  detectSlide,
  REQUEST_TIMEOUT_MS,
  SLIDE_DEADLINE_MS,
  type DetectResult,
} from "./gemini/detect.ts";
import { classifyError } from "./gemini/errors.ts";

export type Budget = {
  signal: AbortSignal;
  remainingMs(): number;
  expired(): boolean;
  dispose(): void;
};

/** Aborts its signal when the time is up, which also cancels a request in flight. */
export function createBudget(totalMs: number, now: () => number = Date.now): Budget {
  const controller = new AbortController();
  const deadline = now() + totalMs;
  const timer = setTimeout(() => controller.abort(), Math.max(0, totalMs));
  return {
    signal: controller.signal,
    remainingMs: () => Math.max(0, deadline - now()),
    expired: () => controller.signal.aborted || now() >= deadline,
    dispose: () => clearTimeout(timer),
  };
}

/** How an item that was not measured ended. */
export type ItemFailure =
  "unavailable" | "quota-exhausted" | "error" | "invalid-response" | "budget";

export type ItemOutcome =
  | {
      ok: true;
      result: Extract<DetectResult, { ok: true }>;
      requests: number;
      codes: Record<string, number>;
    }
  | { ok: false; status: ItemFailure; requests: number; codes: Record<string, number> };

export type MeasureOptions = {
  png: Uint8Array;
  chain: readonly string[];
  mediaResolution: MediaResolutionChoice;
  call: GeminiCall;
  cache: Cache | null;
  /** Real requests allowed for this item, across every round. */
  maxAttempts: number;
  budget: Budget;
  /** Pause before another round after the model was unavailable. */
  pauseMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Passed to detectSlide for its own 4-second final-503 wait; tests skip it. */
  retrySleep?: (ms: number) => Promise<void>;
};

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

/**
 * Detects one item with at most `maxAttempts` real requests. When they are used
 * up without an answer the item is "unavailable" and the run moves on; when
 * the budget runs out, even in the middle of a request, it is "budget".
 * Cached answers cost no attempt.
 */
export async function measureItem(options: MeasureOptions): Promise<ItemOutcome> {
  const { budget, maxAttempts, pauseMs = 10_000, sleep = sleepUnlessAborted } = options;
  const codes: Record<string, number> = {};
  const count = (code: string) => {
    codes[code] = (codes[code] ?? 0) + 1;
  };
  let requests = 0;
  const attemptsUsed = new AbortController();
  const signal = AbortSignal.any([attemptsUsed.signal, budget.signal]);

  const limited: GeminiCall = async (request): Promise<CallResult> => {
    if (requests >= maxAttempts) {
      attemptsUsed.abort();
      throw Object.assign(new Error("attempts used up"), { name: "AbortError" });
    }
    if (budget.expired()) throw Object.assign(new Error("budget spent"), { name: "AbortError" });
    requests += 1;
    try {
      const result = await options.call(request);
      count("response");
      return result;
    } catch (error) {
      count(budget.signal.aborted ? "stopped-by-budget" : classifyError(error).code);
      throw error;
    }
  };

  while (true) {
    if (budget.expired()) return { ok: false, status: "budget", requests, codes };
    let result: DetectResult;
    try {
      const remaining = budget.remainingMs();
      result = await detectSlide({
        png: options.png,
        chain: options.chain,
        mediaResolution: options.mediaResolution,
        call: limited,
        cache: options.cache,
        signal,
        requestTimeoutMs: Math.min(REQUEST_TIMEOUT_MS, remaining),
        deadlineMs: Math.min(SLIDE_DEADLINE_MS, remaining),
        ...(options.retrySleep ? { sleep: options.retrySleep } : {}),
      });
    } catch {
      // Aborted: either the attempts are used up or the budget ran out.
      return { ok: false, status: budget.expired() ? "budget" : "unavailable", requests, codes };
    }
    if (result.ok) return { ok: true, result, requests, codes };
    if (result.reason !== "unavailable" && result.reason !== "deadline") {
      return { ok: false, status: result.reason, requests, codes };
    }
    if (requests >= maxAttempts) return { ok: false, status: "unavailable", requests, codes };
    await sleep(pauseMs, budget.signal);
  }
}

/** Adds one item's codes into a running tally. */
export function addCodes(into: Record<string, number>, codes: Record<string, number>): void {
  for (const [code, value] of Object.entries(codes)) into[code] = (into[code] ?? 0) + value;
}
