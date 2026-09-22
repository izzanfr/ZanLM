import { z } from "zod";

// One source for every enum, used by both the Zod schema that validates the
// answer and the JSON Schema that tells Gemini what to produce.
export const ROLES = [
  "title",
  "subtitle",
  "heading",
  "body",
  "list",
  "table-cell",
  "caption",
  "label",
  "footer",
  "watermark",
  "other",
] as const;
export const FAMILIES = ["sans", "serif", "mono", "display", "handwriting"] as const;
export const WEIGHTS = ["regular", "bold"] as const;
export const ALIGNS = ["left", "center", "right"] as const;

export const MAX_BLOCKS = 200;
export const MAX_BLOCK_CHARACTERS = 4000;
export const MAX_RUNS = 50;

// Bumped whenever the shape of a stored answer changes, so the cache cannot
// hand back an answer in an older shape.
export const SCHEMA_VERSION = 1;

// Gemini sometimes writes "#fff" or leaves out the "#". Both are unambiguous,
// so they are normalised rather than costing the whole slide.
const colorSchema = z
  .string()
  .regex(/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)
  .transform((value) => {
    const hex = value.replace("#", "").toUpperCase();
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return `#${full}`;
  });

// Boxes are only range-checked loosely here. Clipping and rounding happen in
// post-processing, so a box of 1000.4 does not throw away the slide.
const coordinate = z.number().finite().min(-100).max(1100);

export const runSchema = z
  .object({
    text: z.string().min(1).max(MAX_BLOCK_CHARACTERS),
    weight: z.enum(WEIGHTS),
    italic: z.boolean(),
    color: colorSchema,
  })
  .strict();

export const blockSchema = z
  .object({
    text: z.string().max(MAX_BLOCK_CHARACTERS),
    box_2d: z.tuple([coordinate, coordinate, coordinate, coordinate]),
    lines: z.number().int().min(1).max(500),
    role: z.enum(ROLES),
    family: z.enum(FAMILIES),
    weight: z.enum(WEIGHTS),
    italic: z.boolean(),
    color: colorSchema,
    align: z.enum(ALIGNS),
    confident: z.boolean(),
    // Checked separately by checkRuns: a bad `runs` must never cost the text.
    runs: z.unknown().optional(),
  })
  .strict();

export const detectionSchema = z.object({ blocks: z.array(blockSchema).max(MAX_BLOCKS) }).strict();

export type Run = z.infer<typeof runSchema>;
export type RawBlock = z.infer<typeof blockSchema>;
export type Block = Omit<RawBlock, "runs"> & { runs?: Run[] };

/**
 * Keeps `runs` only when they are well formed and join to the block text
 * exactly, with no trimming. Anything else drops the runs and keeps the text.
 * A single run, or none, is the same as a block with one style and is not
 * counted as dropped.
 */
export function checkRuns(runs: unknown, text: string): { runs?: Run[]; dropped: boolean } {
  if (runs === undefined || runs === null) return { dropped: false };
  const parsed = z.array(runSchema).max(MAX_RUNS).safeParse(runs);
  if (!parsed.success) return { dropped: true };
  if (parsed.data.length === 0) return { dropped: false };
  if (parsed.data.map((run) => run.text).join("") !== text) return { dropped: true };
  if (parsed.data.length === 1) return { dropped: false };
  return { runs: parsed.data, dropped: false };
}

export type Detection = { blocks: Block[]; runsDropped: number };

export type ParseResult = { ok: true; detection: Detection } | { ok: false; reason: string };

/** Parses Gemini's JSON text. Never throws; an unusable answer is `ok: false`. */
export function parseDetection(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  const parsed = detectionSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "schema" };

  let runsDropped = 0;
  const blocks = parsed.data.blocks.map((raw): Block => {
    const { runs, ...block } = raw;
    const checked = checkRuns(runs, block.text);
    if (checked.dropped) runsDropped += 1;
    return checked.runs ? { ...block, runs: checked.runs } : block;
  });
  return { ok: true, detection: { blocks, runsDropped } };
}

const enumProperty = (values: readonly string[]) => ({ type: "string", enum: [...values] });
const colorProperty = { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" };

/** JSON Schema sent as `responseJsonSchema`. Kept flat and small on purpose. */
export const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      maxItems: MAX_BLOCKS,
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          box_2d: {
            type: "array",
            items: { type: "integer", minimum: 0, maximum: 1000 },
            minItems: 4,
            maxItems: 4,
          },
          lines: { type: "integer", minimum: 1 },
          role: enumProperty(ROLES),
          family: enumProperty(FAMILIES),
          weight: enumProperty(WEIGHTS),
          italic: { type: "boolean" },
          color: colorProperty,
          align: enumProperty(ALIGNS),
          confident: { type: "boolean" },
          runs: {
            type: "array",
            maxItems: MAX_RUNS,
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                weight: enumProperty(WEIGHTS),
                italic: { type: "boolean" },
                color: colorProperty,
              },
              required: ["text", "weight", "italic", "color"],
            },
          },
        },
        required: [
          "text",
          "box_2d",
          "lines",
          "role",
          "family",
          "weight",
          "italic",
          "color",
          "align",
          "confident",
        ],
      },
    },
  },
  required: ["blocks"],
} as const;
