#!/usr/bin/env npx tsx
/**
 * extract-updates.ts
 * Use an LLM to extract continuity updates (patch JSON) from a chapter.
 * Replaces scripts/extract_updates.py.
 *
 * Usage:
 *   npx tsx skills/novel-writer/ts/extract-updates.ts \
 *     --project mynovel --chapter 8 --title "回响" --text chapter.txt
 *
 * Env vars:
 *   NOVEL_LLM_BASE_URL / OPENAI_BASE_URL  (default: https://api.openai.com/v1)
 *   NOVEL_LLM_API_KEY  / OPENAI_API_KEY
 *   NOVEL_LLM_MODEL    / OPENAI_MODEL     (default: gpt-4o-mini)
 */

import fsSync from "node:fs";
import { parseArgs } from "node:util";

function llmEnv(): { baseUrl: string; apiKey: string; model: string } {
  return {
    baseUrl:
      process.env.NOVEL_LLM_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: process.env.NOVEL_LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    model: process.env.NOVEL_LLM_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  };
}

async function callChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  maxTokens = 1200,
): Promise<string> {
  if (!apiKey) throw new Error("NOVEL_LLM_API_KEY/OPENAI_API_KEY is required");
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

  const { baseUrl, apiKey, model } = llmEnv();
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
