/**
 * Accuracy metrics for `npm run test:detect`. Pure functions over plain data,
 * so they are unit tested in tests/detect-metrics.test.ts without Gemini.
 */

export type Box = readonly [number, number, number, number]; // ymin, xmin, ymax, xmax in 0-1000

export type StyledRun = { text: string; weight: string; italic: boolean };

export type EvalBlock = {
  text: string;
  box_2d: Box;
  role: string;
  runs?: readonly StyledRun[];
};

/** Edit distance over Unicode code points, so an accented letter counts once. */
export function levenshtein(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  let previous = new Int32Array(right.length + 1);
  let current = new Int32Array(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) previous[j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    [previous, current] = [current, previous];
  }
  return previous[right.length];
}

/** Character error rate against the ground truth. */
export function characterErrorRate(truth: string, detected: string): number {
  const length = Array.from(truth).length;
  if (length === 0) return Array.from(detected).length === 0 ? 0 : 1;
  return levenshtein(truth, detected) / length;
}

export function intersectionOverUnion(a: Box, b: Box): number {
  const height = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const width = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const intersection = height * width;
  const area = (box: Box) => Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
  const union = area(a) + area(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

export const MIN_MATCH_IOU = 0.3;

export type Match = { truth: number; detected: number; iou: number };

/** Pairs blocks greedily by descending IoU; each block is used at most once. */
export function matchBlocks(
  truth: readonly EvalBlock[],
  detected: readonly EvalBlock[],
  minimum = MIN_MATCH_IOU,
): { matches: Match[]; missed: number[]; extra: number[] } {
  const candidates: Match[] = [];
  truth.forEach((one, t) => {
    detected.forEach((other, d) => {
      const iou = intersectionOverUnion(one.box_2d, other.box_2d);
      if (iou >= minimum) candidates.push({ truth: t, detected: d, iou });
    });
  });
  candidates.sort((a, b) => b.iou - a.iou || a.truth - b.truth || a.detected - b.detected);
  const usedTruth = new Set<number>();
  const usedDetected = new Set<number>();
  const matches: Match[] = [];
  for (const candidate of candidates) {
    if (usedTruth.has(candidate.truth) || usedDetected.has(candidate.detected)) continue;
    usedTruth.add(candidate.truth);
    usedDetected.add(candidate.detected);
    matches.push(candidate);
  }
  matches.sort((a, b) => a.truth - b.truth);
  return {
    matches,
    missed: truth.map((_, index) => index).filter((index) => !usedTruth.has(index)),
    extra: detected.map((_, index) => index).filter((index) => !usedDetected.has(index)),
  };
}

/**
 * Character offsets where weight or italic changes inside a block. Color-only
 * changes are left out on purpose: colors are estimates on both sides.
 *
 * Whitespace at a run edge is ignored (owner decision, 2026-09-22): a space
 * has no visible style, so "Kondisi: " + "Kekurangan" and "Kondisi:" +
 * " Kekurangan" are the same boundary. Each boundary is placed at the first
 * visible character of the run that starts there.
 */
export function styleBoundaries(block: EvalBlock): number[] {
  if (!block.runs || block.runs.length < 2) return [];
  const boundaries = new Set<number>();
  let offset = 0;
  for (let index = 0; index < block.runs.length; index += 1) {
    const run = block.runs[index];
    const characters = Array.from(run.text);
    if (index > 0) {
      const previous = block.runs[index - 1];
      if (previous.weight !== run.weight || previous.italic !== run.italic) {
        const leading = characters.findIndex((character) => !/\s/.test(character));
        boundaries.add(offset + (leading === -1 ? characters.length : leading));
      }
    }
    offset += characters.length;
  }
  return [...boundaries].sort((a, b) => a - b);
}

export type SlideScore = {
  /** Counts and CER below are for the slide's content: watermarks are left out. */
  truthBlocks: number;
  detectedBlocks: number;
  matched: number;
  missed: number;
  extra: number;
  /** CER of all content text in reading order, independent of how blocks were split. */
  cerReadingOrder: number;
  /** CER over matched content pairs, with missed and extra text counted in full. */
  cerMatched: number;
  meanIou: number | null;
  minIou: number | null;
  /** Style boundaries on matched blocks whose text is exactly right. */
  runBoundaries: { expected: number; found: number; correct: number };
  /** Ground-truth table cells whose match has the same role. */
  roles: { tableCells: number; tableCellsKept: number };
  /**
   * Watermarks, scored apart from the content: how many the ground truth has,
   * how many were detected at all, and how many of those carry the role.
   */
  watermarks: { truth: number; found: number; roleKept: number };
};

/**
 * Splits watermarks off before scoring. A ground-truth watermark and whatever
 * it matched, plus any detected block with the watermark role, never count
 * toward the content CER or the missed and extra blocks.
 */
export function scoreSlide(
  truth: readonly EvalBlock[],
  detected: readonly EvalBlock[],
): SlideScore {
  const all = matchBlocks(truth, detected);
  const watermarkTruth = new Set(
    truth.flatMap((block, index) => (block.role === "watermark" ? [index] : [])),
  );
  const watermarkDetected = new Set(
    detected.flatMap((block, index) => (block.role === "watermark" ? [index] : [])),
  );
  const watermarks = { truth: watermarkTruth.size, found: 0, roleKept: 0 };
  for (const match of all.matches) {
    if (!watermarkTruth.has(match.truth)) continue;
    watermarks.found += 1;
    if (detected[match.detected].role === "watermark") watermarks.roleKept += 1;
    watermarkDetected.add(match.detected);
  }

  const contentTruth = truth.filter((_, index) => !watermarkTruth.has(index));
  const contentDetected = detected.filter((_, index) => !watermarkDetected.has(index));
  const { matches, missed, extra } = matchBlocks(contentTruth, contentDetected);
  const truthText = contentTruth.map((block) => block.text).join("\n");
  const detectedText = contentDetected.map((block) => block.text).join("\n");

  let errors = 0;
  for (const match of matches) {
    errors += levenshtein(contentTruth[match.truth].text, contentDetected[match.detected].text);
  }
  for (const index of missed) errors += Array.from(contentTruth[index].text).length;
  for (const index of extra) errors += Array.from(contentDetected[index].text).length;
  const truthLength = contentTruth.reduce((sum, block) => sum + Array.from(block.text).length, 0);

  const runBoundaries = { expected: 0, found: 0, correct: 0 };
  const roles = { tableCells: 0, tableCellsKept: 0 };
  const matchedByTruth = new Map(matches.map((match) => [match.truth, match.detected]));

  contentTruth.forEach((block, index) => {
    const detectedIndex = matchedByTruth.get(index);
    const partner = detectedIndex === undefined ? undefined : contentDetected[detectedIndex];
    if (block.role === "table-cell") {
      roles.tableCells += 1;
      if (partner?.role === "table-cell") roles.tableCellsKept += 1;
    }
    if (partner && partner.text === block.text) {
      const expected = styleBoundaries(block);
      const found = styleBoundaries(partner);
      runBoundaries.expected += expected.length;
      runBoundaries.found += found.length;
      runBoundaries.correct += found.filter((offset) => expected.includes(offset)).length;
    }
  });

  const ious = matches.map((match) => match.iou);
  return {
    truthBlocks: contentTruth.length,
    detectedBlocks: contentDetected.length,
    matched: matches.length,
    missed: missed.length,
    extra: extra.length,
    cerReadingOrder: characterErrorRate(truthText, detectedText),
    cerMatched: truthLength === 0 ? 0 : errors / truthLength,
    meanIou: ious.length > 0 ? ious.reduce((sum, value) => sum + value, 0) / ious.length : null,
    minIou: ious.length > 0 ? Math.min(...ious) : null,
    runBoundaries,
    roles,
    watermarks,
  };
}
