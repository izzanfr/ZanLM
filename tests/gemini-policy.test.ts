import test from "node:test";
import assert from "node:assert/strict";
import { modelChain, nextStep, type PolicyState } from "../lib/gemini/policy.ts";

const base: PolicyState = {
  tier: 0,
  tierCount: 3,
  outcome: "ok",
  retriedFinal503: false,
  elapsedMs: 0,
  deadlineMs: 180_000,
  requestTimeoutMs: 60_000,
};

test("a good answer ends the slide", () => {
  assert.deepEqual(nextStep({ ...base, outcome: "ok" }), { action: "done" });
});

test("429, 503, timeouts and invalid answers move to the next tier", () => {
  for (const outcome of ["429", "503", "timeout", "invalid-response"] as const) {
    assert.deepEqual(nextStep({ ...base, outcome }), { action: "next-tier", tier: 1 }, outcome);
    assert.deepEqual(
      nextStep({ ...base, tier: 1, outcome }),
      { action: "next-tier", tier: 2 },
      outcome,
    );
  }
});

test("on the last tier, 429 means the quota is exhausted", () => {
  assert.deepEqual(nextStep({ ...base, tier: 2, outcome: "429" }), {
    action: "fail",
    reason: "quota-exhausted",
  });
});

test("on the last tier, 503 is retried exactly once, four seconds later", () => {
  assert.deepEqual(nextStep({ ...base, tier: 2, outcome: "503" }), {
    action: "retry",
    tier: 2,
    afterMs: 4000,
  });
  assert.deepEqual(nextStep({ ...base, tier: 2, outcome: "503", retriedFinal503: true }), {
    action: "fail",
    reason: "unavailable",
  });
});

test("on the last tier, a timeout or an invalid answer fails the slide", () => {
  assert.deepEqual(nextStep({ ...base, tier: 2, outcome: "timeout" }), {
    action: "fail",
    reason: "unavailable",
  });
  assert.deepEqual(nextStep({ ...base, tier: 2, outcome: "invalid-response" }), {
    action: "fail",
    reason: "invalid-response",
  });
});

test("a bad key or request fails at once instead of trying other models", () => {
  for (const tier of [0, 1, 2]) {
    assert.deepEqual(nextStep({ ...base, tier, outcome: "error" }), {
      action: "fail",
      reason: "error",
    });
  }
});

test("no step is taken that cannot finish before the deadline", () => {
  // 130 s used of 180 s: another 60 s request would overrun.
  assert.deepEqual(nextStep({ ...base, outcome: "503", elapsedMs: 130_000 }), {
    action: "fail",
    reason: "deadline",
  });
  // The final 503 retry needs 4 s of waiting plus a whole request.
  assert.deepEqual(nextStep({ ...base, tier: 2, outcome: "503", elapsedMs: 117_000 }), {
    action: "fail",
    reason: "deadline",
  });
  assert.equal(nextStep({ ...base, tier: 2, outcome: "503", elapsedMs: 116_000 }).action, "retry");
});

test("a single-model chain goes straight to the last-tier rules", () => {
  const single = { ...base, tierCount: 1 };
  assert.deepEqual(nextStep({ ...single, outcome: "429" }), {
    action: "fail",
    reason: "quota-exhausted",
  });
  assert.equal(nextStep({ ...single, outcome: "503" }).action, "retry");
});

test("the chain skips empty entries and repeats", () => {
  assert.deepEqual(modelChain(["a", "", "  ", undefined, "b", "a", " c "]), ["a", "b", "c"]);
  assert.deepEqual(modelChain([undefined, ""]), []);
});
