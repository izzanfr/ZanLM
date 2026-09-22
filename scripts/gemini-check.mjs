/**
 * Checks the Gemini setup without spending generation quota:
 *   npm run gemini:check
 *
 * Node loads .env.local into the environment (--env-file-if-exists); this
 * script never opens the file. It prints whether each variable is set and
 * whether each configured model exists, never the key or the configured
 * values, plus the model ids this key can use for generateContent.
 */
import { GoogleGenAI } from "@google/genai";
import { classifyError } from "../lib/gemini/errors.ts";

const key = process.env.GEMINI_API_KEY ?? "";
console.log(`GEMINI_API_KEY: ${key.trim() ? "set" : "not set"}`);
if (!key.trim()) process.exit(1);

const client = new GoogleGenAI({ apiKey: key, httpOptions: { retryOptions: { attempts: 1 } } });
const available = [];
try {
  const pager = await client.models.list({ config: { pageSize: 100 } });
  for await (const model of pager) {
    if ((model.supportedActions ?? []).includes("generateContent") && model.name) {
      available.push(model.name.replace(/^models\//, ""));
    }
  }
} catch (error) {
  console.log(`models.list failed: ${classifyError(error).code}`);
  process.exit(1);
}

for (const name of ["GEMINI_MODEL", "GEMINI_MODEL_FALLBACK", "GEMINI_MODEL_FALLBACK_2"]) {
  const value = (process.env[name] ?? "").trim();
  if (!value) console.log(`${name}: not set`);
  else
    console.log(
      `${name}: set, ${available.includes(value) ? "available" : "NOT available for this key"}`,
    );
}

const flash = available.filter((id) => /flash/i.test(id)).sort();
console.log(`\nFlash-family models this key can use for generateContent (${flash.length}):`);
for (const id of flash) console.log(`  ${id}`);
console.log(`(${available.length} generateContent models in total)`);
