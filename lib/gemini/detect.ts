import { PROMPT_VERSION } from "../prompts/detection.ts";
import { cacheKey, type Cache } from "./cache.ts";
import type { GeminiCall, MediaResolutionChoice, Usage } from "./client.ts";
import { classifyError } from "./errors.ts";
import { nextStep, type FailReason, type Outcome } from "./policy.ts";
import { parseDetection, SCHEMA_VERSION, type Detection } from "./schema.ts";

export const REQUEST_TIMEOUT_MS = 60_000;
export const SLIDE_DEADLINE_MS = 180_000;

export type Attempt = {
  model: string;
  outcome: Outcome;
  /** Short code only, never an error message. */
  code: string;
  ms: number;
  usage: Usage | null;
};

export type DetectResult =
  | {
      ok: true;
      detection: Detection;
      model: string;
      fromCache: boolean;
      calls: number;
      attempts: Attempt[];
      usage: Usage | null;
    }
  | { ok: false; reason: FailReason; calls: number; attempts: Attempt[] };

export type DetectOptions = {
  png: Uint8Array;
  /** Model ids in fallback order; one entry means no fallback. */
  chain: readonly string[];
  mediaResolution: MediaResolutionChoice;
  call: GeminiCall;
  cache?: Cache | null;
  requestTimeoutMs?: number;
  deadlineMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Detects one slide: cache first, then the model chain under the fallback
 * policy. Only answers that pass validation are cached or returned.
 */
export async function detectSlide(options: DetectOptions): Promise<DetectResult> {
  const {
    png,
    chain,
    mediaResolution,
    call,
    cache = null,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    deadlineMs = SLIDE_DEADLINE_MS,
    signal,
    now = Date.now,
    sleep = wait,
  } = options;
  if (chain.length === 0) {
    return { ok: false, reason: "error", calls: 0, attempts: [] };
  }

  // A cached answer from any model in the chain counts, in chain order.
  if (cache) {
    for (const model of chain) {
      const entry = await cache.get(cacheKey(png, model, mediaResolution));
      if (!entry) continue;
      const parsed = parseDetection(entry.text);
      if (parsed.ok) {
        return {
          ok: true,
          detection: parsed.detection,
          model,
          fromCache: true,
          calls: 0,
          attempts: [],
          usage: entry.usage,
        };
      }
    }
  }

  const started = now();
  const attempts: Attempt[] = [];
  let tier = 0;
  let retriedFinal503 = false;
  let calls = 0;

  while (true) {
    signal?.throwIfAborted();
    const model = chain[tier];
    const attemptStarted = now();
    let outcome: Outcome;
    let code = "ok";
    let usage: Usage | null = null;
    let detection: Detection | null = null;
    let text = "";

    try {
      calls += 1;
      const result = await call({
        model,
        png,
        mediaResolution,
        timeoutMs: requestTimeoutMs,
        signal,
      });
      usage = result.usage;
      text = result.text;
      const parsed = parseDetection(text);
      if (parsed.ok) {
        outcome = "ok";
        detection = parsed.detection;
      } else {
        outcome = "invalid-response";
        code = `invalid-${parsed.reason}`;
      }
    } catch (error) {
      // Cancelling the job is not a Gemini failure and must not move tiers.
      if (signal?.aborted) throw error;
      ({ outcome, code } = classifyError(error));
    }

    attempts.push({ model, outcome, code, ms: now() - attemptStarted, usage });

    if (outcome === "ok" && detection) {
      if (cache) {
        await cache.set(cacheKey(png, model, mediaResolution), {
          version: 1,
          model,
          mediaResolution,
          promptVersion: PROMPT_VERSION,
          schemaVersion: SCHEMA_VERSION,
          createdAt: Date.now(),
          text,
          usage: usage ?? {
            promptTokens: null,
            outputTokens: null,
            thoughtsTokens: null,
            totalTokens: null,
          },
        });
      }
      return { ok: true, detection, model, fromCache: false, calls, attempts, usage };
    }

    const step = nextStep({
      tier,
      tierCount: chain.length,
      outcome,
      retriedFinal503,
      elapsedMs: now() - started,
      deadlineMs,
      requestTimeoutMs,
    });
    if (step.action === "fail") return { ok: false, reason: step.reason, calls, attempts };
    if (step.action === "retry") {
      retriedFinal503 = true;
      await sleep(step.afterMs);
      continue;
    }
    if (step.action === "next-tier") tier = step.tier;
  }
}
