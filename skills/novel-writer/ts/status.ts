#!/usr/bin/env npx tsx
/**
 * status.ts
 * Show current project progress: last chapter, recent timeline.
 * Replaces scripts/status.py.
 *
 * Usage:
 *   npx tsx skills/novel-writer/ts/status.ts --project mynovel --recent 5
 */

import fsSync from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { PROJECTS_DIR } from "./apply-patch.js";

function loadJson(filePath: string, fallback: unknown): any {
  if (!fsSync.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fsSync.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function readRecentTimeline(filePath: string, limit: number): unknown[] {
  if (!fsSync.existsSync(filePath)) return [];
  try {
    const lines = fsSync
      .readFileSync(filePath, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    return lines.slice(-limit).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      recent: { type: "string", default: "5" },
    },
    strict: true,
  });

  if (!values.project) {
    console.error("--project is required");
    process.exit(1);
  }

  const project = values.project;
  const recent = parseInt(values.recent!, 10);

  const statePath = path.join(PROJECTS_DIR, project, "state.json");
  const timelinePath = path.join(PROJECTS_DIR, project, "memory", "timeline.jsonl");

  const state = loadJson(statePath, {});
  const timeline = readRecentTimeline(timelinePath, recent);

  const output = {
    status: "ok",
    project,
    last_chapter: state.last_chapter ?? null,
    last_title: state.last_title ?? null,
    updated_at: state.updated_at ?? null,
    chapters_written: state.chapters_written ?? [],
    recent_timeline: timeline,
  };
  console.log(JSON.stringify(output, null, 2));
}

main();
