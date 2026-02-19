#!/usr/bin/env npx tsx
/**
 * ingest-timeline.ts
 * Index timeline.jsonl entries into a per-project timeline memory DB.
 * Replaces LanceDB timeline storage.
 *
 * Usage:
 *   npx tsx skills/novel-writer/ts/ingest-timeline.ts --project mynovel
 */

import fsSync from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { NovelMemoryStore } from "./novel-memory.js";

const PROJECTS_DIR = path.resolve(import.meta.dirname, "../projects");

function timelineDbPath(project: string): string {
  return path.join(PROJECTS_DIR, project, "timeline_memory.sqlite");
}

function timelineJsonlPath(project: string): string {
  return path.join(PROJECTS_DIR, project, "memory", "timeline.jsonl");
}

type TimelineEntry = {
  chapter?: string | number;
  scene?: string | number;
  title?: string;
  summary?: string;
  details?: string;
  characters?: string[];
  location?: string;
  timestamp?: string;
  [key: string]: unknown;
};

function entryToMarkdown(entry: TimelineEntry, index: number): string {
  const parts: string[] = [];

  // Heading
  const chapter = entry.chapter ?? "";
  const scene = entry.scene ?? "";
  const title = entry.title ?? "";
  let heading = "##";
  if (chapter) heading += ` Chapter ${chapter}`;
  if (scene) heading += ` — Scene ${scene}`;
  if (title) heading += ` — ${title}`;
  if (heading === "##") heading += ` Entry ${index + 1}`;
  parts.push(heading);

  // Metadata
  if (entry.timestamp) parts.push(`Time: ${entry.timestamp}`);
  if (entry.location) parts.push(`Location: ${entry.location}`);
  if (entry.characters?.length) parts.push(`Characters: ${entry.characters.join(", ")}`);

  parts.push("");

  // Body
  if (entry.summary) parts.push(entry.summary);
  if (entry.details) parts.push("", entry.details);

  return parts.join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      force: { type: "boolean", default: false },
    },
    strict: true,
  });

  const project = values.project;
  if (!project) {
    console.error("--project is required");
    process.exit(1);
  }

  const jsonlPath = timelineJsonlPath(project);
  if (!fsSync.existsSync(jsonlPath)) {
    console.error(`timeline.jsonl not found: ${jsonlPath}`);
    process.exit(1);
  }

  const lines = fsSync
    .readFileSync(jsonlPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim());

  if (lines.length === 0) {
    console.log(JSON.stringify({ status: "ok", entries: 0, message: "empty timeline" }));
    return;
  }

  console.error(`Found ${lines.length} timeline entries, opening DB...`);

  const store = await NovelMemoryStore.open({
    dbPath: timelineDbPath(project),
    source: "timeline",
  });

  let indexed = 0;
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    let entry: TimelineEntry;
    try {
      entry = JSON.parse(lines[i]!) as TimelineEntry;
    } catch {
      console.error(`  skipping malformed line ${i + 1}`);
      continue;
    }

    const markdown = entryToMarkdown(entry, i);
    const virtualPath = `timeline/entry-${String(i).padStart(5, "0")}`;

    const result = await store.indexContent({
      virtualPath,
      content: markdown,
      force: values.force,
    });

    if (result.skipped) {
      skipped++;
    } else {
      indexed += result.chunks;
    }
  }

  const stats = store.stats();
  store.close();

  const output = {
    status: "ok",
    backend: "verso-memory",
    db: timelineDbPath(project),
    entriesProcessed: lines.length,
    chunksIndexed: indexed,
    chunksSkipped: skipped,
    totalFiles: stats.files,
    totalChunks: stats.chunks,
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
