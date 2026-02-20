#!/usr/bin/env npx tsx
/**
 * context.ts
 * Full context assembler for novel-writer.
 * Style and timeline search delegate to NovelMemoryStore.search() which
 * reads query settings (maxResults, minScore, hybrid weights) from verso config.
 * Timeline recent uses ratio-based token budget from dynamic context params.
 *
 * Usage:
 *   npx tsx skills/novel-writer/ts/context.ts \
 *     --project mynovel \
 *     --outline "Chapter 5: The dark forest" \
 *     --style "gothic atmosphere" \
 *     --budget 8000
 */

import fsSync from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_CONTEXT_PARAMS, loadContextParams } from "../../../src/agents/dynamic-context.js";
import { NovelMemoryStore } from "./novel-memory.js";

const PROJECTS_DIR = path.resolve(import.meta.dirname, "../projects");
const STYLE_DB_PATH = path.resolve(import.meta.dirname, "../style/style_memory.sqlite");

/** Default total token budget for timeline recent. */
const DEFAULT_BUDGET_TOKENS = 8000;

function projectDir(project: string): string {
  return path.join(PROJECTS_DIR, project);
}

function memoryFilePath(project: string, file: string): string {
  return path.join(PROJECTS_DIR, project, "memory", file);
}

function timelineDbPath(project: string): string {
  return path.join(PROJECTS_DIR, project, "timeline_memory.sqlite");
}

function loadJson(filePath: string, fallback: unknown): unknown {
  if (!fsSync.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fsSync.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function loadJsonl(filePath: string): unknown[] {
  if (!fsSync.existsSync(filePath)) return [];
  try {
    return fsSync
      .readFileSync(filePath, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Select recent timeline entries by walking backwards until token budget is exhausted.
 */
function selectRecentTimeline(
  entries: unknown[],
  budgetTokens: number,
): { selected: unknown[]; count: number } {
  if (entries.length === 0 || budgetTokens <= 0) {
    return { selected: [], count: 0 };
  }
  const selected: unknown[] = [];
  let tokensUsed = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const text = JSON.stringify(entries[i]);
    const tokens = estimateTokens(text);
    if (tokensUsed + tokens > budgetTokens && selected.length > 0) {
      break;
    }
    selected.unshift(entries[i]);
    tokensUsed += tokens;
  }
  return { selected, count: selected.length };
}

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      outline: { type: "string", default: "" },
      style: { type: "string", default: "" },
      budget: { type: "string", default: "" },
    },
    strict: true,
  });

  const project = values.project;
  if (!project) {
    console.error("--project is required");
    process.exit(1);
  }

  const budget = values.budget ? parseInt(values.budget, 10) : DEFAULT_BUDGET_TOKENS;
  const contextParams = await loadContextParams();
  const recentRatio = contextParams.recentRatioBase ?? DEFAULT_CONTEXT_PARAMS.recentRatioBase;
  const timelineRecentBudget = Math.floor(budget * recentRatio);

  // Load flat JSON memory (always loaded in full)
  const characters = loadJson(memoryFilePath(project, "characters.json"), { characters: [] });
  const worldBible = loadJson(memoryFilePath(project, "world_bible.json"), {
    world: {},
    protected_keys: [],
  });
  const plotThreads = loadJson(memoryFilePath(project, "plot_threads.json"), { threads: [] });
  const state = loadJson(path.join(projectDir(project), "state.json"), {});
  const defaultStyle = loadJson(path.join(projectDir(project), "style", "default_style.json"), {});

  // Load full timeline + select recent by budget
  const fullTimeline = loadJsonl(memoryFilePath(project, "timeline.jsonl"));
  const { selected: timelineRecent, count: timelineRecentCount } = selectRecentTimeline(
    fullTimeline,
    timelineRecentBudget,
  );

  // Build search query from outline + style
  const query = (values.outline || values.style || "").trim();

  let styleSnippets: unknown[] = [];
  let timelineHits: unknown[] = [];

  // Style and timeline search: NovelMemoryStore.search() uses verso config
  // settings internally (maxResults, minScore, hybrid weights, candidateMultiplier)
  if (query) {
    if (fsSync.existsSync(STYLE_DB_PATH)) {
      try {
        const styleStore = await NovelMemoryStore.open({
          dbPath: STYLE_DB_PATH,
          source: "style",
        });
        const results = await styleStore.search({ query });
        styleSnippets = results.map((r) => ({
          text: r.snippet,
          score: Math.round(r.score * 1000) / 1000,
          path: r.path,
        }));
        styleStore.close();
      } catch (err) {
        console.error(`style search failed: ${err}`);
      }
    }

    const tlDbPath = timelineDbPath(project);
    if (fsSync.existsSync(tlDbPath)) {
      try {
        const tlStore = await NovelMemoryStore.open({
          dbPath: tlDbPath,
          source: "timeline",
        });
        const results = await tlStore.search({ query });
        timelineHits = results.map((r) => ({
          text: r.snippet,
          score: Math.round(r.score * 1000) / 1000,
          path: r.path,
        }));
        tlStore.close();
      } catch (err) {
        console.error(`timeline search failed: ${err}`);
      }
    }
  }

  const output = {
    status: "ok",
    project,
    meta: {
      budget,
      recent_ratio: recentRatio,
      timeline_recent_budget: timelineRecentBudget,
      timeline_recent_count: timelineRecentCount,
      style_results: styleSnippets.length,
      timeline_search_results: timelineHits.length,
    },
    state,
    characters,
    world_bible: worldBible,
    plot_threads: plotThreads,
    timeline_recent: timelineRecent,
    timeline_hits: timelineHits,
    style_snippets: styleSnippets,
    default_style: defaultStyle,
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
