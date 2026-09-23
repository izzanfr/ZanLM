import "server-only";
import { createGeminiCall, type GeminiCall } from "./client.ts";
import { modelChain } from "./policy.ts";

/**
 * The only module that reads the key. It passes the value to the client and
 * nothing else: it is never logged, never written to job.json and never
 * returned to a route. `.env.local` itself is never opened here; Node loads it.
 */
export function hasApiKey(): boolean {
  return (process.env.GEMINI_API_KEY ?? "").trim().length > 0;
}

export function createServerCall(): GeminiCall {
  const key = (process.env.GEMINI_API_KEY ?? "").trim();
  if (!key) throw new Error("no api key");
  return createGeminiCall(key);
}

/** The configured chain, in order, with empty entries skipped. */
export function serverModelChain(): string[] {
  return modelChain([
    process.env.GEMINI_MODEL,
    process.env.GEMINI_MODEL_FALLBACK,
    process.env.GEMINI_MODEL_FALLBACK_2,
  ]);
}
