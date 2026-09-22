/**
 * Masked input for scripts/setup.mjs, read straight from the terminal in raw
 * mode instead of through readline.
 *
 * Every key is handled here: Enter submits, Backspace deletes, Ctrl+U clears,
 * Ctrl+C cancels, and escape sequences (arrow keys, bracketed paste markers,
 * Windows Terminal key records) are dropped instead of leaking into the code.
 * Each accepted character is echoed as "*", so a keystroke that never arrives
 * is visible instead of silently failing validation later.
 *
 * applyChunk is pure and unit tested in tests/hidden-input.test.ts.
 */

export const MAX_LENGTH = 256;
export const CODE_PATTERN = /^[A-Za-z0-9_-]{12,128}$/;

// A complete CSI or SS3 sequence. A bare ESC (the Esc key) is not one of
// these; it falls through to the control-character filter, so it can never
// swallow the key typed after it.
const ESCAPE_SEQUENCE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|O[\s\S])/g;
// The start of a sequence that the next chunk will finish.
const PARTIAL_ESCAPE = /\x1b(?:\[[0-?]*[ -/]*|O)?$/;

/**
 * @typedef {{ chars: string[], pending: string, skipLineFeed: boolean, usedCtrlV: boolean }} InputState
 * @typedef {{ type: "submit", value: string, rest: string, endedWithCarriageReturn: boolean } | { type: "cancel" }} InputResult
 * @typedef {{ state: InputState, echo: string, result: InputResult | null }} InputStep
 */

/** @returns {InputState} */
export function createInputState() {
  return { chars: [], pending: "", skipLineFeed: false, usedCtrlV: false };
}

/**
 * Applies one chunk of terminal input.
 *
 * Returns the new state, the text to echo, and a result once the line is
 * finished: `{ type: "submit", value, rest, endedWithCarriageReturn }` or
 * `{ type: "cancel" }`. `rest` is whatever followed the Enter in the same
 * chunk, such as the second line of a paste, and belongs to the next prompt.
 *
 * @param {InputState} state
 * @param {string} chunk
 * @returns {InputStep}
 */
export function applyChunk(state, chunk) {
  let text = state.pending + chunk;
  let pending = "";
  const partial = PARTIAL_ESCAPE.exec(text);
  if (partial) {
    pending = partial[0];
    text = text.slice(0, partial.index);
  }
  text = text.replace(ESCAPE_SEQUENCE, "");

  /** @type {string[]} */
  let chars = [...state.chars];
  let skipLineFeed = state.skipLineFeed;
  let usedCtrlV = state.usedCtrlV;
  let echo = "";
  const next = () => ({ chars, pending, skipLineFeed, usedCtrlV });
  const units = Array.from(text);

  for (let index = 0; index < units.length; index += 1) {
    const character = units[index];
    // A "\r\n" split across two chunks must not submit an empty second line.
    if (skipLineFeed) {
      skipLineFeed = false;
      if (character === "\n") continue;
    }
    if (character === "\r" || character === "\n") {
      let restStart = index + 1;
      if (character === "\r" && units[restStart] === "\n") restStart += 1;
      const rest = units.slice(restStart).join("") + pending;
      return {
        state: next(),
        echo,
        result: {
          type: "submit",
          value: chars.join(""),
          rest,
          endedWithCarriageReturn: character === "\r" && restStart === index + 1 && rest === "",
        },
      };
    }
    if (character === "\x03") return { state: next(), echo, result: { type: "cancel" } };
    if (character === "\x04") {
      if (chars.length === 0) return { state: next(), echo, result: { type: "cancel" } };
      continue;
    }
    if (character === "\b" || character === "\x7f") {
      if (chars.length > 0) {
        chars.pop();
        echo += "\b \b";
      }
      continue;
    }
    if (character === "\x15") {
      echo += "\b \b".repeat(chars.length);
      chars = [];
      continue;
    }
    if (character === "\x16") {
      // In raw mode a classic console delivers Ctrl+V as a character instead
      // of pasting. Remember it so the error can say how to paste instead.
      usedCtrlV = true;
      continue;
    }
    if (character < " ") continue;
    if (chars.length >= MAX_LENGTH) continue;
    chars.push(character);
    echo += "*";
  }
  return { state: next(), echo, result: null };
}

/**
 * Says why a code is not accepted, without repeating the code itself.
 * Returns null for a valid code.
 *
 * @param {string} code
 * @param {{ usedCtrlV?: boolean }} [options]
 * @returns {string | null}
 */
export function describeCodeProblem(code, { usedCtrlV = false } = {}) {
  if (CODE_PATTERN.test(code)) return null;
  const problems = [];
  const length = Array.from(code).length;
  if (length === 0) problems.push("Nothing was received.");
  else if (length < 12 || length > 128) {
    problems.push(`The code has ${length} characters; it needs 12 to 128.`);
  }
  const kinds = new Set();
  for (const character of code) {
    if (/[A-Za-z0-9_-]/.test(character)) continue;
    if (/\s/.test(character)) kinds.add("spaces");
    else if (/[\p{L}\p{N}]/u.test(character)) kinds.add("letters or digits outside A-Z and 0-9");
    else kinds.add("symbols other than _ and -");
  }
  if (kinds.size > 0) {
    problems.push(`It contains ${[...kinds].join(" and ")}, which are not allowed.`);
  }
  if (usedCtrlV) {
    problems.push(
      "Ctrl+V does not paste here: paste with right-click or Ctrl+Shift+V, or type it.",
    );
  }
  return problems.join(" ");
}

function cancelled() {
  return Object.assign(new Error("Setup cancelled."), { code: "CANCELLED" });
}

/** Asks questions one at a time with masked input. Needs a TTY stdin. */
export function createHiddenReader({ input = process.stdin, output = process.stdout } = {}) {
  let carry = "";
  let skipLineFeed = false;

  function question(prompt) {
    return new Promise((resolve, reject) => {
      let state = { ...createInputState(), skipLineFeed };
      let settled = false;

      function finish(error, answer) {
        if (settled) return;
        settled = true;
        input.off("data", onData);
        input.off("end", onEnd);
        input.setRawMode(false);
        input.pause();
        output.write("\n");
        if (error) reject(error);
        else resolve(answer);
      }

      function onData(chunk) {
        const step = applyChunk(state, typeof chunk === "string" ? chunk : chunk.toString("utf8"));
        state = step.state;
        if (step.echo) output.write(step.echo);
        if (!step.result) return;
        if (step.result.type === "cancel") {
          finish(cancelled());
          return;
        }
        carry = step.result.rest;
        skipLineFeed = step.result.endedWithCarriageReturn;
        finish(null, { value: step.result.value, usedCtrlV: state.usedCtrlV });
      }

      function onEnd() {
        finish(cancelled());
      }

      output.write(prompt);
      input.setRawMode(true);
      input.setEncoding("utf8");
      input.on("data", onData);
      input.once("end", onEnd);
      input.resume();
      if (carry) {
        const leftover = carry;
        carry = "";
        onData(leftover);
      }
    });
  }

  return { question };
}
