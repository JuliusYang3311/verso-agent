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

import { type Api, completeSimple, type Model } from "@mariozechner/pi-ai";
import fsSync from "node:fs";
import { parseArgs } from "node:util";
import { getApiKeyForModel, requireApiKey } from "../../../src/agents/model-auth.js";
import { resolveConfiguredModelRef } from "../../../src/agents/model-selection.js";
import { resolveModel } from "../../../src/agents/pi-embedded-runner/model.js";
import { loadConfig } from "../../../src/config/config.js";

function loadVersoConfig() {
  try {
    return loadConfig();
  } catch {
    return {} as any;
  }
}

async function resolveLlmModel(): Promise<{ model: Model<Api>; apiKey: string }> {
  const cfg = loadVersoConfig();

  // Resolve model ref from agents.defaults.model.primary
  const ref = resolveConfiguredModelRef({
    cfg,
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4-20250514",
  });

  // Resolve the full Model object (handles all provider types, baseUrl, api format)
  const { model, error } = resolveModel(ref.provider, ref.model, undefined, cfg);
  if (!model || error) {
    throw new Error(`Failed to resolve model ${ref.provider}/${ref.model}: ${error ?? "unknown"}`);
  }

  // Resolve auth
  const auth = await getApiKeyForModel({ model, cfg });
  const apiKey = requireApiKey(auth, ref.provider);

  return { model, apiKey };
}

/** Strip markdown code fences from LLM output (```json ... ```). */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return match ? match[1].trim() : trimmed;
}

async function main() {
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

  const chapterText = fsSync.readFileSync(values.text, "utf-8");
  const maxTokens = parseInt(values["max-tokens"]!, 10);

  const systemPrompt =
    "Extract continuity updates as JSON patch. Never delete protected entries. " +
    "Output only JSON with keys: characters, world_bible, timeline, plot_threads. " +
    "Timeline must include a concise summary.";

  const userContent = JSON.stringify(
    {
      chapter: parseInt(values.chapter, 10),
      title: values.title,
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

  const { model, apiKey } = await resolveLlmModel();

  const res = await completeSimple(
    model,
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
    {
      apiKey,
      maxTokens,
    },
  );

  const rawText = res.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Strip markdown code fences and output clean JSON
  console.log(stripCodeFences(rawText));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
