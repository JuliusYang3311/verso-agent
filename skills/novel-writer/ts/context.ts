#!/usr/bin/env npx tsx
/**
 * context.ts
 * Full context assembler for novel-writer.
 * Replaces scripts/context.py — loads JSON memory files + searches
 * style and timeline DBs via verso's memory infrastructure.
 *
 * Usage:
 *   npx tsx skills/novel-writer/ts/context.ts \
 *     --project mynovel \
 *     --outline "Chapter 5: The dark forest" \
 *     --style "gothic atmosphere" \
 *     --recent 5 --limit 5
 */

import fsSync from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { NovelMemoryStore } from "./novel-memory.js";

const PROJECTS_DIR = path.resolve(import.meta.dirname, "../projects");
const STYLE_DB_PATH = path.resolve(import.meta.dirname, "../style/style_memory.sqlite");

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

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      outline: { type: "string", default: "" },
      style: { type: "string", default: "" },
      recent: { type: "string", default: "5" },
      limit: { type: "string", default: "5" },
      "min-score": { type: "string", default: "0.2" },
    },
    strict: true,
  });

  const project = values.project;
  if (!project) {
    console.error("--project is required");
    process.exit(1);
  }

  const recent = parseInt(values.recent!, 10);
  const limit = parseInt(values.limit!, 10);
  const minScore = parseFloat(values["min-score"]!);

  // Load flat JSON memory (always loaded in full)
  const characters = loadJson(memoryFilePath(project, "characters.json"), { characters: [] });
  const worldBible = loadJson(memoryFilePath(project, "world_bible.json"), {
    world: {},
    protected_keys: [],
  });
  const plotThreads = loadJson(memoryFilePath(project, "plot_threads.json"), { threads: [] });

  // Load state
  const state = loadJson(path.join(projectDir(project), "state.json"), {});

  // Load default style
  const defaultStyle = loadJson(path.join(projectDir(project), "style", "default_style.json"), {});

  // Recent timeline entries (tail read from JSONL)
  const fullTimeline = loadJsonl(memoryFilePath(project, "timeline.jsonl"));
  const timelineRecent = fullTimeline.slice(-recent);

  // Build search query from outline + style
  const query = (values.outline || values.style || "").trim();

  let styleSnippets: unknown[] = [];
  let timelineHits: unknown[] = [];

  if (query) {
    // Search style DB
    if (fsSync.existsSync(STYLE_DB_PATH)) {
      try {
        const styleStore = await NovelMemoryStore.open({
          dbPath: STYLE_DB_PATH,
          source: "style",
        });
        const results = await styleStore.search({ query, limit, minScore });
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

    // Search timeline DB
    const tlDbPath = timelineDbPath(project);
    if (fsSync.existsSync(tlDbPath)) {
      try {
        const tlStore = await NovelMemoryStore.open({
          dbPath: tlDbPath,
          source: "timeline",
        });
        const results = await tlStore.search({ query, limit, minScore });
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
