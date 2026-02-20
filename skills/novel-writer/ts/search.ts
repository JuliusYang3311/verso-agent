#!/usr/bin/env npx tsx
/**
 * search.ts
 * Unified search CLI for novel-writer style and timeline DBs.
 * Uses verso config query settings (maxResults, minScore, hybrid weights).
 *
 * Usage:
 *   npx tsx skills/novel-writer/ts/search.ts \
 *     --db style --query "dark gothic atmosphere"
 *   npx tsx skills/novel-writer/ts/search.ts \
 *     --db timeline --project mynovel --query "betrayal scene"
 */

import fsSync from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { NovelMemoryStore } from "./novel-memory.js";

const STYLE_DB_PATH = path.resolve(import.meta.dirname, "../style/style_memory.sqlite");
const PROJECTS_DIR = path.resolve(import.meta.dirname, "../projects");

function timelineDbPath(project: string): string {
  return path.join(PROJECTS_DIR, project, "timeline_memory.sqlite");
}

async function main() {
  const { values } = parseArgs({
    options: {
      db: { type: "string" },
      project: { type: "string", default: "" },
      query: { type: "string" },
    },
    strict: true,
  });

  const dbType = values.db;
  if (!dbType || !["style", "timeline"].includes(dbType)) {
    console.error("--db must be 'style' or 'timeline'");
    process.exit(1);
  }

  const query = values.query;
  if (!query) {
    console.error("--query is required");
    process.exit(1);
  }

  let dbPath: string;
  if (dbType === "style") {
    dbPath = STYLE_DB_PATH;
  } else {
    const project = values.project;
    if (!project) {
      console.error("--project is required for timeline search");
      process.exit(1);
    }
    dbPath = timelineDbPath(project);
  }

  if (!fsSync.existsSync(dbPath)) {
    console.error(`DB not found: ${dbPath}. Run the ingest script first.`);
    process.exit(1);
  }

  const store = await NovelMemoryStore.open({
    dbPath,
    source: dbType,
  });

  const results = await store.search({ query });
  store.close();

  const output = {
    status: "ok",
    db: dbType,
    query,
    results: results.map((r) => ({
      path: r.path,
      score: Math.round(r.score * 1000) / 1000,
      snippet: r.snippet,
      startLine: r.startLine,
      endLine: r.endLine,
    })),
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
