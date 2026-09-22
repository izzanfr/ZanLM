import test from "node:test";
import assert from "node:assert/strict";
import {
  characterErrorRate,
  intersectionOverUnion,
  levenshtein,
  matchBlocks,
  scoreSlide,
  styleBoundaries,
  type Box,
  type EvalBlock,
} from "../lib/detect-metrics.ts";

const block = (text: string, box: Box, role = "body", runs?: EvalBlock["runs"]): EvalBlock => ({
  text,
  box_2d: box,
  role,
  runs,
});

test("edit distance counts characters, not bytes", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("abc", "abc"), 0);
  // An accented letter or a curly quote is one character.
  assert.equal(levenshtein("é", "e"), 1);
  assert.equal(levenshtein("“quote”", '"quote"'), 2);
  assert.equal(levenshtein("line\nbreak", "line break"), 1);
});

test("CER is the edit distance over the ground-truth length", () => {
  assert.equal(characterErrorRate("abcd", "abcd"), 0);
  assert.equal(characterErrorRate("abcd", "abxd"), 0.25);
  assert.equal(characterErrorRate("ab", ""), 1);
  assert.equal(characterErrorRate("", ""), 0);
});

test("IoU is 1 for the same box and 0 for disjoint boxes", () => {
  assert.equal(intersectionOverUnion([0, 0, 100, 100], [0, 0, 100, 100]), 1);
  assert.equal(intersectionOverUnion([0, 0, 100, 100], [200, 200, 300, 300]), 0);
  // Half overlap along one axis: 50 / 150.
  assert.equal(intersectionOverUnion([0, 0, 100, 100], [0, 50, 100, 150]), 1 / 3);
});

test("blocks are paired by best overlap, each used once", () => {
  const truth = [block("a", [0, 0, 100, 100]), block("b", [0, 200, 100, 300])];
  const detected = [
    block("b", [0, 210, 100, 300]),
    block("a", [0, 0, 100, 90]),
    block("noise", [800, 800, 900, 900]),
  ];
  const { matches, missed, extra } = matchBlocks(truth, detected);
  assert.deepEqual(
    matches.map((match) => [match.truth, match.detected]),
    [
      [0, 1],
      [1, 0],
    ],
  );
  assert.deepEqual(missed, []);
  assert.deepEqual(extra, [2]);
});

test("a detection that merges two blocks leaves one of them missed", () => {
  const truth = [block("Heading", [0, 0, 50, 500]), block("Body text", [60, 0, 200, 500])];
  const detected = [block("Heading\nBody text", [0, 0, 200, 500])];
  const score = scoreSlide(truth, detected);
  assert.equal(score.matched, 1);
  assert.equal(score.missed, 1);
  // Reading-order CER does not punish the merge: only "\n" vs "\n" matters.
  assert.equal(score.cerReadingOrder, 0);
  assert.ok(score.cerMatched > 0);
});

test("style boundaries follow weight and italic, not color", () => {
  const runs = [
    { text: "Note:", weight: "bold", italic: false },
    { text: " apply ", weight: "regular", italic: false },
    { text: "twice", weight: "regular", italic: true },
    { text: " a day", weight: "regular", italic: false },
  ];
  assert.deepEqual(
    styleBoundaries(block("Note: apply twice a day", [0, 0, 1, 1], "body", runs)),
    [5, 12, 17],
  );
  const colorOnly = [
    { text: "Ramuan", weight: "bold", italic: false },
    { text: " two", weight: "bold", italic: false },
  ];
  assert.deepEqual(styleBoundaries(block("Ramuan two", [0, 0, 1, 1], "title", colorOnly)), []);
  assert.deepEqual(styleBoundaries(block("plain", [0, 0, 1, 1])), []);
});

test("a slide score counts runs, roles, misses and extras", () => {
  const runs = [
    { text: "SENSITIVE", weight: "bold", italic: false },
    { text: "\n(Abu-abu)", weight: "regular", italic: false },
  ];
  const truth = [
    block("SENSITIVE\n(Abu-abu)", [300, 500, 360, 650], "table-cell", runs),
    block("Gemini Notebook", [970, 930, 990, 995], "watermark"),
    block("Missing", [500, 0, 550, 200]),
  ];
  const detected = [
    block("SENSITIVE\n(Abu-abu)", [300, 505, 360, 650], "table-cell", runs),
    block("Gemini Notebook", [970, 930, 990, 995], "footer"),
    block("Extra", [700, 700, 750, 800]),
  ];
  const score = scoreSlide(truth, detected);
  assert.equal(score.matched, 2);
  assert.equal(score.missed, 1);
  assert.equal(score.extra, 1);
  assert.deepEqual(score.runBoundaries, { expected: 1, found: 1, correct: 1 });
  assert.deepEqual(score.roles, {
    tableCells: 1,
    tableCellsKept: 1,
    watermarks: 1,
    watermarksKept: 0,
  });
  assert.ok(score.meanIou !== null && score.meanIou > 0.9);
});

test("a perfect detection scores zero error", () => {
  const truth = [block("Title", [0, 0, 100, 500], "title"), block("Body", [200, 0, 300, 500])];
  const score = scoreSlide(truth, truth);
  assert.equal(score.cerReadingOrder, 0);
  assert.equal(score.cerMatched, 0);
  assert.equal(score.missed, 0);
  assert.equal(score.extra, 0);
  assert.equal(score.meanIou, 1);
});

test("an empty detection misses everything", () => {
  const score = scoreSlide([block("Title", [0, 0, 100, 500])], []);
  assert.equal(score.cerReadingOrder, 1);
  assert.equal(score.cerMatched, 1);
  assert.equal(score.missed, 1);
  assert.equal(score.meanIou, null);
});
