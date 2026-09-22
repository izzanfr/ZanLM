import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reads the real stylesheet: the navbar hide/show is plain CSS, so only the
// cascade decides whether reduced motion keeps the navbar in place.
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

type Specificity = [ids: number, classes: number, elements: number];

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function compare(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// Enough of the specificity rules for the selectors this stylesheet uses:
// ids, classes, attributes, pseudo-classes, elements and :not(), whose
// argument contributes its own specificity.
function specificity(selector: string): Specificity {
  let ids = 0;
  let classes = 0;
  let elements = 0;
  let rest = selector.replace(/:not\(([^()]*)\)/g, (_match, args: string) => {
    let worst: Specificity = [0, 0, 0];
    for (const argument of args.split(",")) {
      const inner = specificity(argument);
      if (compare(inner, worst) > 0) worst = inner;
    }
    ids += worst[0];
    classes += worst[1];
    elements += worst[2];
    return " ";
  });
  rest = rest.replace(/::[\w-]+/g, () => {
    elements += 1;
    return " ";
  });
  ids += count(rest, /#[\w-]+/g);
  classes += count(rest, /\.[\w-]+/g) + count(rest, /\[[^\]]*\]/g) + count(rest, /:[\w-]+/g);
  elements += count(rest, /(?:^|[\s>+~])[a-zA-Z][\w-]*/g);
  return [ids, classes, elements];
}

test("the specificity helper matches the CSS rules it is used on", () => {
  assert.deepEqual(specificity(".site-header.nav-hidden"), [0, 2, 0]);
  assert.deepEqual(specificity(".site-header.nav-hidden:not(:focus-within)"), [0, 3, 0]);
  assert.deepEqual(specificity("header.site-header"), [0, 1, 1]);
  assert.deepEqual(specificity("#main"), [1, 0, 0]);
});

function reducedMotionBlock(): { start: number; end: number } {
  const start = css.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.ok(start >= 0, "globals.css must have a prefers-reduced-motion block");
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return { start, end: i };
    }
  }
  return assert.fail("unterminated prefers-reduced-motion block");
}

type Rule = { selector: string; transform: string; index: number; reducedMotion: boolean };

function navbarTransformRules(): Rule[] {
  const block = reducedMotionBlock();
  const rules: Rule[] = [];
  for (const match of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    if (!selector.includes(".site-header") || !selector.includes(".nav-hidden")) continue;
    const transform = /(?:^|[;\s])transform:\s*([^;]+);/.exec(match[2]);
    if (!transform) continue;
    const index = match.index;
    rules.push({
      selector,
      transform: transform[1].trim(),
      index,
      reducedMotion: index > block.start && index < block.end,
    });
  }
  return rules;
}

test("reduced motion keeps the navbar visible instead of hiding it on scroll", () => {
  const rules = navbarTransformRules();
  const hide = rules.filter((rule) => !rule.reducedMotion);
  const keep = rules.filter((rule) => rule.reducedMotion);

  assert.equal(hide.length, 1, "expected exactly one rule that hides the navbar on scroll");
  assert.equal(keep.length, 1, "expected exactly one reduced-motion override");

  // The override only works if it is not out-specified by the hide rule, so
  // this is the assertion that the reported specificity bug stays fixed.
  const order = compare(specificity(keep[0].selector), specificity(hide[0].selector));
  assert.ok(
    order > 0 || (order === 0 && keep[0].index > hide[0].index),
    `"${keep[0].selector}" does not override "${hide[0].selector}"`,
  );
  assert.ok(
    !hide[0].transform.includes("!important"),
    "the hide rule must not use !important, which would beat the reduced-motion override",
  );

  // Same transform as the resting navbar: horizontal centering only, so the
  // navbar never leaves the viewport.
  assert.equal(keep[0].transform, "translateX(-50%)");
  assert.match(hide[0].transform, /-150%/);
});
