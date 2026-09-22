import { constants } from "node:fs";
import { access, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createHiddenReader, describeCodeProblem } from "./hidden-input.mjs";

// This script never reads or overwrites an existing environment file. It only
// checks whether one exists, and the final write uses the "wx" flag, so a file
// created in the meantime is not replaced either.
const target = new URL("../.env.local", import.meta.url);
const ATTEMPTS = 3;
const EXISTS_MESSAGE = "Configuration already exists (.env.local). It was not read or changed.";

function environment(code) {
  return [
    `ACCESS_CODE=${code}`,
    `SESSION_SECRET=${randomBytes(48).toString("hex")}`,
    "GEMINI_API_KEY=",
    "GEMINI_MODEL=",
    "GEMINI_MODEL_FALLBACK=",
    "GEMINI_MODEL_FALLBACK_2=",
    `WORKER_SECRET=${randomBytes(32).toString("hex")}`,
    "WORKER_URL=http://127.0.0.1:8000",
    "MAX_UPLOAD_MB=50",
    "MAX_SLIDES=40",
    "",
  ].join("\n");
}

async function exists(url) {
  try {
    await access(url, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function fail(message, exitCode = 1) {
  console.error(message);
  process.exitCode = exitCode;
}

// Leave the terminal usable even if something throws while it is in raw mode.
process.on("exit", () => {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    // Nothing more can be done at exit.
  }
});

async function main() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    fail("Run npm run setup in an interactive terminal.");
    return;
  }
  // Checked before anything is asked, so no one types a code for nothing.
  if (await exists(target)) {
    fail(EXISTS_MESSAGE);
    return;
  }

  const reader = createHiddenReader();
  process.stdout.write(
    "Choose an access code of 12 to 128 characters, using only letters A-Z, digits, _ and -.\n" +
      "Each character shows as *. Press Ctrl+C to cancel.\n",
  );

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const first = await reader.question("Access code: ");
    const problem = describeCodeProblem(first.value, { usedCtrlV: first.usedCtrlV });
    if (problem) {
      console.error(problem);
      continue;
    }
    const second = await reader.question("Confirm access code: ");
    if (second.value !== first.value) {
      console.error("The two entries did not match.");
      continue;
    }
    await writeFile(target, environment(first.value), { flag: "wx", mode: 0o600 });
    console.log("Configuration created. Run npm run dev and sign in with your chosen code.");
    return;
  }
  fail(`No valid code after ${ATTEMPTS} attempts. Nothing was written.`);
}

try {
  await main();
} catch (error) {
  if (error?.code === "CANCELLED") fail("Setup cancelled. Nothing was written.", 130);
  else if (error?.code === "EEXIST") fail(EXISTS_MESSAGE);
  else fail(error instanceof Error ? error.message : String(error));
}
