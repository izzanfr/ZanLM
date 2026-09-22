import type { Outcome } from "./policy.ts";

/**
 * Turns whatever a Gemini call threw into a policy outcome and a short code.
 *
 * The error's message is never kept: an SDK or network message can echo a
 * request URL, headers or part of a response, and nothing from a request may
 * reach job.json, the cache or a log line. Only the HTTP status survives.
 */
export function classifyError(error: unknown): { outcome: Outcome; code: string } {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return { outcome: "timeout", code: "timeout" };
  }
  const status = statusOf(error);
  if (status === 429) return { outcome: "429", code: "http-429" };
  // 500, 502 and 504 are the same "try elsewhere" situation as 503.
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return { outcome: "503", code: `http-${status}` };
  }
  if (status !== null) return { outcome: "error", code: `http-${status}` };
  return { outcome: "error", code: "network" };
}

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const status = (error as { status: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}
