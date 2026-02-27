#!/usr/bin/env npx tsx
/**
 * extract-updates.ts
 * Use an LLM to extract continuity updates (patch JSON) from a chapter.
 * Resolves LLM provider/model/auth from verso config (agents.defaults.model).
 * Uses pi-ai's completeSimple for API-agnostic LLM calls (OpenAI, Anthropic, Google, etc.).
 *
 * Usage:
 *   npx tsx skills/novel-writer/ts/extract-updates.ts \
 *     --project mynovel --chapter 8 --title "回响" --text chapter.txt
 */

import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import {
  type Api,
  type AssistantMessage,
  type Context,
  completeSimple,
  type Model,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { resolveConfiguredModelRef } from "../../../src/agents/model-selection.js";
import { resolveModel } from "../../../src/agents/pi-embedded-runner/model.js";
import { loadConfig } from "../../../src/config/config.js";

// --- LLM resolution (mirrors evolver/sandbox-agent.ts) ---

export interface ResolvedLlm {
  model: Model<Api>;
  authStorage: AuthStorage;
  provider: string;
}

/**
 * Resolve the model + auth for novel-writer LLM calls.
 * Mirrors the evolver pattern (sandbox-agent.ts):
 *   1. NOVEL_WRITER_MODEL env → or config defaults
 *   2. resolveModel() → Model + AuthStorage + ModelRegistry
 *   3. Bridge verso auth into AuthStorage via setRuntimeApiKey()
 *
 * Callers should use {@link novelComplete} instead of completeSimple directly.
 */
export async function resolveLlmModel(): Promise<ResolvedLlm> {
  const cfg = (() => {
    try {
      return loadConfig();
    } catch {
      return {} as any;
    }
  })();

  const envModel = process.env.NOVEL_WRITER_MODEL;
  let provider: string;
  let modelId: string;

  if (envModel && envModel.includes("/")) {
    [provider, modelId] = envModel.split("/", 2);
  } else {
    const ref = resolveConfiguredModelRef({
      cfg,
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-20250514",
    });
    provider = ref.provider;
    modelId = ref.model;
  }

  const agentDir = process.env.NOVEL_WRITER_AGENT_DIR || undefined;
  const { model, error, authStorage } = resolveModel(provider, modelId, agentDir, cfg);
  if (!model || error) {
    throw new Error(`Failed to resolve model ${provider}/${modelId}: ${error ?? "unknown"}`);
  }

  // Bridge verso's auth into pi-coding-agent's AuthStorage so custom providers
  // (e.g. OAuth, "newapi") are recognized. resolveApiKeyForProvider walks verso's
  // full auth chain (profiles → env → config apiKey → OAuth token refresh) and we
  // inject the result as a runtime override — no disk writes, no side effects.
  const { resolveApiKeyForProvider } = await import("../../../src/agents/model-auth.js");
  try {
    const auth = await resolveApiKeyForProvider({ provider, cfg, agentDir });
    if (auth.apiKey) {
      authStorage.setRuntimeApiKey(provider, auth.apiKey);
    }
  } catch {
    // best-effort: if verso can't resolve the key, let pi-coding-agent
    // try its own fallbacks (env vars, auth.json, OAuth refresh, etc.)
  }

  return { model, authStorage, provider };
}

/**
 * High-level LLM completion for novel-writer.
 * Auth is resolved from AuthStorage (supports API key, OAuth, token, etc.)
 * — callers never handle raw credentials.
 */
export async function novelComplete(
  llm: ResolvedLlm,
  context: Context,
  opts?: Omit<SimpleStreamOptions, "apiKey">,
): Promise<AssistantMessage> {
  const apiKey = (await llm.authStorage.getApiKey(llm.provider)) ?? "";
  return completeSimple(llm.model, context, { ...opts, apiKey });
}

export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return match ? match[1].trim() : trimmed;
}

/**
 * Attempt to repair common LLM JSON errors:
 * - Trailing commas before } or ]
 * - Missing closing brackets
 * - Single-line // comments
 */
function repairJson(raw: string): string {
  let s = raw;
  // Strip single-line comments
  s = s.replace(/\/\/[^\n]*/g, "");
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, "$1");
  // Try to balance brackets
  const opens = (s.match(/[{[]/g) ?? []).length;
  const closes = (s.match(/[}\]]/g) ?? []).length;
  if (opens > closes) {
    // Count unmatched { vs [
    let braces = 0;
    let brackets = 0;
    for (const ch of s) {
      if (ch === "{") {
        braces++;
      }
      if (ch === "}") {
        braces--;
      }
      if (ch === "[") {
        brackets++;
      }
      if (ch === "]") {
        brackets--;
      }
    }
    for (let i = 0; i < brackets; i++) {
      s += "]";
    }
    for (let i = 0; i < braces; i++) {
      s += "}";
    }
  }
  return s;
}

export function safeParseJson(text: string): Record<string, unknown> {
  const stripped = stripCodeFences(text);
  // First try direct parse
  try {
    return JSON.parse(stripped);
  } catch {
    // Try repair
    try {
      return JSON.parse(repairJson(stripped));
    } catch (e) {
      throw new Error(
        `Failed to parse LLM JSON after repair: ${e instanceof Error ? e.message : String(e)}\nRaw: ${stripped.slice(0, 500)}`,
      );
    }
  }
}

export interface ExtractUpdatesOpts {
  chapter: number;
  title: string;
  chapterText: string;
  maxTokens?: number;
}

export async function extractUpdates(opts: ExtractUpdatesOpts): Promise<Record<string, unknown>> {
  const { chapter, title, chapterText, maxTokens = 1200 } = opts;

  const systemPrompt =
    "Extract continuity updates as JSON patch. Never delete protected entries. " +
    "Output only JSON with keys: characters, world_bible, timeline, plot_threads. " +
    "Timeline must include a concise summary.";

  const userContent = JSON.stringify(
    {
      chapter,
      title,
      text: chapterText,
      schema: {
        characters: { add: [], update: [], delete: [] },
        world_bible: { add: {}, update: {}, delete: [] },
        timeline: {
          summary: "",
          events: [],
          consequences: [],
          pov: "",
          locations: [],
          characters: [],
        },
        plot_threads: { add: [], update: [], close: [] },
      },
    },
    null,
    0,
  );

  const llm = await resolveLlmModel();

  const res = await novelComplete(
    llm,
    {
      systemPrompt,
      messages: [
        {
          role: "user",
          content: userContent,
          timestamp: Date.now(),
        },
      ],
    },
    { maxTokens },
  );

  const rawText = res.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return safeParseJson(rawText);
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      chapter: { type: "string" },
      title: { type: "string" },
      text: { type: "string" },
      "max-tokens": { type: "string", default: "1200" },
    },
    strict: true,
  });
  if (!values.project || !values.chapter || !values.title || !values.text) {
    console.error("--project, --chapter, --title, --text are all required");
    process.exit(1);
  }
  if (!fsSync.existsSync(values.text)) {
    console.error(`text file not found: ${values.text}`);
    process.exit(1);
  }
  extractUpdates({
    chapter: parseInt(values.chapter, 10),
    title: values.title,
    chapterText: fsSync.readFileSync(values.text, "utf-8"),
    maxTokens: values["max-tokens"] ? parseInt(values["max-tokens"], 10) : undefined,
  })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
