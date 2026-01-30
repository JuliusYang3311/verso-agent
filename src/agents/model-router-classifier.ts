/**
 * Router classifier helper for making lightweight LLM calls.
 * Used by the smart model router to classify tasks.
 */

import { completeSimple, getModel, type Api, type Model } from "@mariozechner/pi-ai";
import type { VersoConfig } from "../config/config.js";
import { resolveApiKeyForProvider } from "./model-auth.js";
import { logVerbose } from "../globals.js";

/**
 * Parameters for the classifier call.
 */
export type ClassifierCallParams = {
  provider: string;
  model: string;
  prompt: string;
  timeoutMs: number;
};

/**
 * Make a simple LLM call for task classification.
 * Uses completeSimple for fast, low-latency responses.
 */
export async function callTaskClassifier(
  params: ClassifierCallParams,
  cfg?: VersoConfig,
  agentDir?: string,
): Promise<string> {
  const { provider, model, prompt, timeoutMs } = params;

  // Get API key for the classifier model's provider
  const auth = await resolveApiKeyForProvider({
    provider,
    cfg,
    agentDir,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelObj = getModel(provider as any, model);
  if (!modelObj) {
    throw new Error(`Failed to get model: ${provider}/${model}`);
  }

  // INTERNAL RETRY LOOP
  let attempts = 0;
  const maxRetries = 3;
  let lastError: unknown;

  while (attempts < maxRetries) {
    attempts++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Use the correct API: completeSimple(model, context, options)
      const result = await completeSimple(
        modelObj as Model<Api>,
        {
          messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
        },
        {
          apiKey: auth.apiKey,
          maxTokens: 1024, // High limit to avoid truncation
          temperature: 0, // Deterministic selection
          signal: controller.signal,
        },
      );

      // Extract text content from the result (AssistantMessage)
      if (!result.content) {
        lastError = new Error("Empty response from classifier");
        continue; // Retry
      }

      const content = result.content;
      if (typeof content === "string") {
        clearTimeout(timeoutId);
        return content;
      }
      // Content is array of ContentPart - extract text
      for (const part of content) {
        if (typeof part === "string") {
          clearTimeout(timeoutId);
          return part;
        }
        if (part && typeof part === "object" && "type" in part && part.type === "text") {
          clearTimeout(timeoutId);
          return (part as { type: "text"; text: string }).text;
        }
      }

      lastError = new Error("No text part in response");
      // Retry (loop continues)
    } catch (err) {
      lastError = err;
      // Retry on error
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Fallback if all retries failed
  logVerbose(`Classifier failed after ${maxRetries} attempts: ${lastError}`);
  return "";
}

/**
 * Create a classifier function bound to the current config.
 * This is used to inject the classifier into resolveRouterModel.
 */
export function createClassifierFn(
  cfg: VersoConfig,
  agentDir?: string,
): (params: ClassifierCallParams) => Promise<string> {
  return async (params: ClassifierCallParams) => {
    logVerbose(`Router classifying task with ${params.provider}/${params.model}`);
    const result = await callTaskClassifier(params, cfg, agentDir);
    logVerbose(`Router classification result: ${result.trim()}`);
    return result;
  };
}
