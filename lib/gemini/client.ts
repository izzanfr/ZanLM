import { GoogleGenAI, MediaResolution } from "@google/genai";
import { DETECTION_PROMPT } from "../prompts/detection.ts";
import { RESPONSE_JSON_SCHEMA } from "./schema.ts";

export const MEDIA_RESOLUTIONS = ["default", "low", "medium", "high"] as const;
export type MediaResolutionChoice = (typeof MEDIA_RESOLUTIONS)[number];

const SDK_MEDIA_RESOLUTION: Record<Exclude<MediaResolutionChoice, "default">, MediaResolution> = {
  low: MediaResolution.MEDIA_RESOLUTION_LOW,
  medium: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  high: MediaResolution.MEDIA_RESOLUTION_HIGH,
};

export type Usage = {
  promptTokens: number | null;
  outputTokens: number | null;
  thoughtsTokens: number | null;
  totalTokens: number | null;
};

export type CallRequest = {
  model: string;
  png: Uint8Array;
  mediaResolution: MediaResolutionChoice;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type CallResult = { text: string; usage: Usage };

/** One request, no retries. Injected into detectSlide so tests never touch the network. */
export type GeminiCall = (request: CallRequest) => Promise<CallResult>;

/**
 * The thin wrapper around the SDK. The key is a parameter: this module never
 * reads the environment, so it can be used by the app (through a server-only
 * caller) and by the command-line tools alike.
 */
export function createGeminiCall(apiKey: string): GeminiCall {
  const client = new GoogleGenAI({
    apiKey,
    // The SDK retries 408, 429 and 5xx up to five times when retries are
    // enabled. Retrying is the fallback policy's decision, and every request
    // must be counted, so the SDK makes exactly one attempt.
    httpOptions: { retryOptions: { attempts: 1 } },
  });

  return async ({ model, png, mediaResolution, timeoutMs, signal }) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { text: DETECTION_PROMPT },
            { inlineData: { mimeType: "image/png", data: Buffer.from(png).toString("base64") } },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_JSON_SCHEMA,
        temperature: 0,
        abortSignal,
        ...(mediaResolution === "default"
          ? {}
          : { mediaResolution: SDK_MEDIA_RESOLUTION[mediaResolution] }),
      },
    });
    const usage = response.usageMetadata;
    return {
      text: response.text ?? "",
      usage: {
        promptTokens: usage?.promptTokenCount ?? null,
        outputTokens: usage?.candidatesTokenCount ?? null,
        thoughtsTokens: usage?.thoughtsTokenCount ?? null,
        totalTokens: usage?.totalTokenCount ?? null,
      },
    };
  };
}
