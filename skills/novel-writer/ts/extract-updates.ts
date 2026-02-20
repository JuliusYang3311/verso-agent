#!/usr/bin/env npx tsx
/**
 * extract-updates.ts
 * Use an LLM to extract continuity updates (patch JSON) from a chapter.
 * Resolves LLM provider/model/auth from verso config (agents.defaults.model).
 *
 * Usage:
 *   npx tsx skills/novel-writer/ts/extract-updates.ts \
 *     --project mynovel --chapter 8 --title "回响" --text chapter.txt
 */

import fsSync from "node:fs";
import { parseArgs } from "node:util";
import type { ModelProviderConfig } from "../../../src/config/types.js";
import { resolveApiKeyForProvider, requireApiKey } from "../../../src/agents/model-auth.js";
import { resolveConfiguredModelRef } from "../../../src/agents/model-selection.js";
import { loadConfig } from "../../../src/config/config.js";

function loadVersoConfig() {
  try {
    return loadConfig();
  } catch {
    return {} as any;
  }
}

async function resolveLlm(): Promise<{ baseUrl: string; apiKey: string; model: string }> {
  const cfg = loadVersoConfig();

  // Resolve model ref from agents.defaults.model.primary
  const ref = resolveConfiguredModelRef({
    cfg,
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4-20250514",
  });

  // Resolve provider config for baseUrl
  const providers = cfg?.models?.providers ?? {};
  const providerCfg = providers[ref.provider] as ModelProviderConfig | undefined;
  const baseUrl = providerCfg?.baseUrl ?? "https://api.openai.com/v1";

  // Resolve auth (api-key, oauth, token, aws-sdk)
  const auth = await resolveApiKeyForProvider({ provider: ref.provider, cfg });
  const apiKey = requireApiKey(auth, ref.provider);

  return { baseUrl, apiKey, model: ref.model };
}

async function callChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  maxTokens = 1200,
): Promise<string> {
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.8,
      max_tokens: maxTokens,
    }),
  });
  if (!resp.ok) {
    throw new Error(`LLM API error: ${resp.status} ${await resp.text()}`);
  }
  const data = (await resp.json()) as any;
  return data.choices[0].message.content;
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

  const system =
    "Extract continuity updates as JSON patch. Never delete protected entries. " +
    "Output only JSON with keys: characters, world_bible, timeline, plot_threads. " +
    "Timeline must include a concise summary.";

  const user = JSON.stringify(
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

  const { baseUrl, apiKey, model } = await resolveLlm();
  const content = await callChat(
    baseUrl,
    apiKey,
    model,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens,
  );

  // Output the raw LLM response (should be JSON)
  console.log(content);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
