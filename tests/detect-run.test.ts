import test from "node:test";
import assert from "node:assert/strict";
import type { CallRequest, CallResult, GeminiCall } from "../lib/gemini/client.ts";
import { addCodes, createBudget, measureItem, type Budget } from "../lib/detect-run.ts";

// A fake Gemini only: nothing here touches the network.

const png = new Uint8Array([137, 80, 78, 71, 9]);
const usage = { promptTokens: 1, outputTokens: 1, thoughtsTokens: null, totalTokens: 2 };
const ok = JSON.stringify({ blocks: [] });

class HttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`status ${status}`);
    this.status = status;
  }
}

function scripted(steps: Array<string | Error>) {
  const requests: CallRequest[] = [];
  const call: GeminiCall = async (request): Promise<CallResult> => {
    requests.push(request);
    const step = steps[requests.length - 1] ?? new HttpError(503);
    if (step instanceof Error) throw step;
    return { text: step, usage };
  };
  return { call, requests };
}

const noSleep = async () => {};
const roomy = (): Budget => ({
  signal: new AbortController().signal,
  remainingMs: () => 600_000,
  expired: () => false,
  dispose: () => {},
});

test("an item never makes more real requests than --max-attempts", async () => {
  const { call, requests } = scripted([]);
  const outcome = await measureItem({
    png,
    chain: ["m"],
    mediaResolution: "default",
    call,
    cache: null,
    maxAttempts: 3,
    budget: roomy(),
    sleep: noSleep,
    retrySleep: noSleep,
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok && outcome.status === "unavailable");
  assert.equal(requests.length, 3);
  assert.equal(outcome.requests, 3);
  assert.deepEqual(outcome.codes, { "http-503": 3 });
});

test("an answer inside the cap ends the item at once", async () => {
  const { call, requests } = scripted([new HttpError(503), ok]);
  const outcome = await measureItem({
    png,
    chain: ["m"],
    mediaResolution: "default",
    call,
    cache: null,
    maxAttempts: 3,
    budget: roomy(),
    sleep: noSleep,
    retrySleep: noSleep,
  });
  assert.ok(outcome.ok);
  assert.equal(requests.length, 2);
  assert.deepEqual(outcome.codes, { "http-503": 1, response: 1 });
});

test("exhausted quota or a rejected request is not retried", async () => {
  for (const [error, status] of [
    [new HttpError(429), "quota-exhausted"],
    [new HttpError(400), "error"],
  ] as const) {
    const { call, requests } = scripted([error, error, error]);
    const outcome = await measureItem({
      png,
      chain: ["m"],
      mediaResolution: "default",
      call,
      cache: null,
      maxAttempts: 3,
      budget: roomy(),
      sleep: noSleep,
      retrySleep: noSleep,
    });
    assert.ok(!outcome.ok && outcome.status === status, status);
    assert.equal(requests.length, 1, status);
  }
});

test("the budget stops a request that is still running", async () => {
  const budget = createBudget(50);
  const call: GeminiCall = (request) =>
    new Promise((_, reject) => {
      request.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    });
  const started = Date.now();
  const outcome = await measureItem({
    png,
    chain: ["m"],
    mediaResolution: "default",
    call,
    cache: null,
    maxAttempts: 3,
    budget,
  });
  budget.dispose();
  assert.ok(!outcome.ok && outcome.status === "budget");
  assert.ok(Date.now() - started < 5_000, "the hanging request must be cut off by the budget");
});

test("a spent budget makes no request at all", async () => {
  const { call, requests } = scripted([ok]);
  const spent: Budget = { ...roomy(), expired: () => true, remainingMs: () => 0 };
  const outcome = await measureItem({
    png,
    chain: ["m"],
    mediaResolution: "default",
    call,
    cache: null,
    maxAttempts: 3,
    budget: spent,
  });
  assert.ok(!outcome.ok && outcome.status === "budget");
  assert.equal(requests.length, 0);
});

test("the budget reports what is left and when it is spent", async () => {
  let clock = 1_000;
  const budget = createBudget(10_000, () => clock);
  assert.equal(budget.remainingMs(), 10_000);
  assert.equal(budget.expired(), false);
  clock = 11_000;
  assert.equal(budget.remainingMs(), 0);
  assert.equal(budget.expired(), true);
  budget.dispose();
});

test("codes add up across items", () => {
  const total: Record<string, number> = {};
  addCodes(total, { "http-503": 2, response: 1 });
  addCodes(total, { "http-503": 1, timeout: 1 });
  assert.deepEqual(total, { "http-503": 3, response: 1, timeout: 1 });
});
