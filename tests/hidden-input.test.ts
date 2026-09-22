import test from "node:test";
import assert from "node:assert/strict";
import {
  applyChunk,
  createInputState,
  describeCodeProblem,
  MAX_LENGTH,
} from "../scripts/hidden-input.mjs";

type Step = ReturnType<typeof applyChunk>;

/** Feeds chunks in order and returns every step, like the terminal would. */
function feed(...chunks: string[]): Step[] {
  let state = createInputState();
  const steps: Step[] = [];
  for (const chunk of chunks) {
    const step = applyChunk(state, chunk);
    steps.push(step);
    state = step.state;
    if (step.result) break;
  }
  return steps;
}

function submitted(...chunks: string[]): string {
  const result = feed(...chunks).at(-1)?.result;
  assert.ok(result && result.type === "submit", "expected the line to be submitted");
  return result.value;
}

test("typed characters are collected and Enter submits them", () => {
  assert.equal(submitted("Valid_code-1234\r"), "Valid_code-1234");
  // One key per chunk, the way a person types.
  assert.equal(submitted(..."Valid_code-1234\r".split("")), "Valid_code-1234");
  assert.equal(submitted("abc\n"), "abc");
});

test("every accepted character is echoed as a star, and nothing else", () => {
  const [step] = feed("abc");
  assert.equal(step.echo, "***");
  assert.doesNotMatch(step.echo, /[abc]/);
});

test("Backspace deletes, whether the terminal sends BS or DEL", () => {
  assert.equal(submitted("abcX\bdef\r"), "abcdef");
  assert.equal(submitted("abcX\x7fdef\r"), "abcdef");
  // Backspace on an empty line is harmless.
  assert.equal(submitted("\b\b\x7fab\r"), "ab");
  const [step] = feed("ab\b");
  assert.equal(step.echo, "**\b \b");
});

test("Ctrl+U clears the line", () => {
  assert.equal(submitted("wrong\x15right\r"), "right");
});

test("Ctrl+C cancels, and Ctrl+D cancels only an empty line", () => {
  assert.deepEqual(feed("abc\x03").at(-1)?.result, { type: "cancel" });
  assert.deepEqual(feed("\x04").at(-1)?.result, { type: "cancel" });
  assert.equal(submitted("ab\x04c\r"), "abc");
});

test("escape sequences never end up in the code", () => {
  // Arrow keys, Home/End, and Delete.
  assert.equal(submitted("ab\x1b[D\x1b[C\x1b[H\x1b[F\x1b[3~cd\r"), "abcd");
  // Windows Terminal win32-input-mode records, including a key-up left over
  // from the Enter that launched the command.
  assert.equal(submitted("\x1b[13;28;13;0;0;1_abc\r"), "abc");
  // Bracketed paste markers.
  assert.equal(submitted("\x1b[200~pasted\x1b[201~\r"), "pasted");
  // SS3 function keys.
  assert.equal(submitted("a\x1bOPb\r"), "ab");
  // A bare Esc press does not swallow the next key.
  assert.equal(submitted("a\x1bb\r"), "ab");
});

test("a sequence split across chunks is still recognised", () => {
  assert.equal(submitted("ab\x1b", "[13;28;13;", "0;0;1_cd\r"), "abcd");
  assert.equal(submitted("ab\x1b[", "D", "c\r"), "abc");
});

test("a paste with a trailing newline submits once and keeps the rest", () => {
  const result = feed("first\r\nsecond\r\n").at(-1)?.result;
  assert.ok(result && result.type === "submit");
  assert.equal(result.value, "first");
  assert.equal(result.rest, "second\r\n");
});

test("a CRLF split across chunks does not submit an empty second answer", () => {
  const first = feed("code\r").at(-1);
  assert.ok(first?.result && first.result.type === "submit");
  assert.equal(first.result.endedWithCarriageReturn, true);
  // The next prompt starts with the lone "\n" of that CRLF.
  let state = { ...createInputState(), skipLineFeed: true };
  const step = applyChunk(state, "\ncode\r");
  state = step.state;
  assert.ok(step.result && step.result.type === "submit");
  assert.equal(step.result.value, "code");
});

test("other control characters are ignored, and Ctrl+V is remembered", () => {
  assert.equal(submitted("a\x00\x07\tb\r"), "ab");
  const steps = feed("\x16\r");
  const last = steps.at(-1);
  assert.equal(last?.state.usedCtrlV, true);
  assert.ok(last?.result && last.result.type === "submit");
  assert.equal(last.result.value, "");
});

test("input is capped so a huge paste cannot grow without bound", () => {
  assert.equal(submitted("x".repeat(MAX_LENGTH + 50) + "\r").length, MAX_LENGTH);
});

test("non-ASCII input survives as typed, so validation can explain it", () => {
  assert.equal(submitted("kodé-rahasia\r"), "kodé-rahasia");
});

test("a valid code has no problem", () => {
  assert.equal(describeCodeProblem("Valid_code-1234"), null);
  assert.equal(describeCodeProblem("a".repeat(12)), null);
  assert.equal(describeCodeProblem("a".repeat(128)), null);
});

test("rejections say why without repeating the code", () => {
  const secret = "Izzan@2026!secret";
  const message = describeCodeProblem(secret) ?? "";
  assert.match(message, /symbols other than _ and -/);
  assert.ok(!message.includes(secret), "the code must not be echoed back");
  assert.ok(!message.includes("@") && !message.includes("!"));

  assert.match(describeCodeProblem("") ?? "", /Nothing was received/);
  assert.match(describeCodeProblem("short") ?? "", /has 5 characters; it needs 12 to 128/);
  assert.match(describeCodeProblem("a".repeat(129)) ?? "", /has 129 characters/);
  assert.match(describeCodeProblem("with a space1") ?? "", /spaces/);
  assert.match(describeCodeProblem("kodé-rahasia-1") ?? "", /letters or digits outside A-Z/);
});

test("an empty entry after Ctrl+V explains how to paste", () => {
  assert.match(describeCodeProblem("", { usedCtrlV: true }) ?? "", /right-click or Ctrl\+Shift\+V/);
});
