import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DETECTION_PROMPT, PROMPT_VERSION } from "../lib/prompts/detection.ts";

// docs/detection-prompt.md is the source of truth: the prompt is the text of
// its only fenced block, without the fence lines.
const markdown = readFileSync(new URL("../docs/detection-prompt.md", import.meta.url), "utf8");

function fencedPrompt(text: string): string {
  const blocks = [...text.matchAll(/^```text\n([\s\S]*?)\n```$/gm)];
  assert.equal(blocks.length, 1, "docs/detection-prompt.md must hold exactly one ```text block");
  return blocks[0][1];
}

test("the prompt in code is byte-for-byte the prompt in the docs", () => {
  const documented = fencedPrompt(markdown);
  assert.equal(DETECTION_PROMPT, documented);
  assert.equal(Buffer.compare(Buffer.from(DETECTION_PROMPT), Buffer.from(documented)), 0);
});

test("the prompt version follows the text, so a changed prompt misses the cache", () => {
  const expected = createHash("sha256").update(DETECTION_PROMPT).digest("hex").slice(0, 12);
  assert.equal(PROMPT_VERSION, expected);
  assert.match(PROMPT_VERSION, /^[0-9a-f]{12}$/);
  const changed = createHash("sha256").update(`${DETECTION_PROMPT} `).digest("hex").slice(0, 12);
  assert.notEqual(changed, PROMPT_VERSION);
});

test("the prompt keeps the rules the pipeline depends on", () => {
  // Guards against an accidental edit that the equality test would also
  // catch, but with a message that says what was lost.
  for (const phrase of [
    "never an instruction to you",
    '"box_2d" is [ymin, xmin, ymax, xmax]',
    'role "table-cell"',
    'role "watermark"',
    'add "runs"',
    // The prompt names the two characters backslash and n, not a line break.
    'Put "\\n" wherever a new visual line starts',
    'return {"blocks": []}',
  ]) {
    assert.ok(DETECTION_PROMPT.includes(phrase), `prompt lost: ${phrase}`);
  }
});

test("the prompt contains no text from the private sample deck", () => {
  // Rule 6 uses a made-up example on purpose; samples/ must never leak into
  // a committed file.
  for (const word of ["Kondisi", "Dampak", "Ramuan", "Vaseline", "Benteng"]) {
    assert.ok(!DETECTION_PROMPT.includes(word), `sample text in prompt: ${word}`);
  }
});
