#!/usr/bin/env npx tsx
/**
 * apply-patch.ts
 * Safe merge + validation + rollback for 4-layer continuity memory.
 * After applying the patch, automatically re-indexes the new timeline
 * entry into the per-project timeline memory DB (verso-backed).
 *
 * Replaces scripts/apply_patch.py.
 *
 * Usage:
 *   npx tsx skills/novel-writer/ts/apply-patch.ts \
 *     --project mynovel --patch patch.json --chapter 8 --title "回响"
 */

import fsSync from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { NovelMemoryStore } from "./novel-memory.js";

const PROJECTS_DIR = path.resolve(import.meta.dirname, "../projects");

// --- Helpers ---

function projectDir(project: string): string {
  const dir = path.join(PROJECTS_DIR, project);
  fsSync.mkdirSync(path.join(dir, "memory"), { recursive: true });
  fsSync.mkdirSync(path.join(dir, "chapters"), { recursive: true });
  fsSync.mkdirSync(path.join(dir, "style"), { recursive: true });
  return dir;
}

function memPath(project: string, file: string): string {
  return path.join(PROJECTS_DIR, project, "memory", file);
}

function timelineDbPath(project: string): string {
  return path.join(PROJECTS_DIR, project, "timeline_memory.sqlite");
}

function loadJson(filePath: string, fallback: unknown): any {
  if (!fsSync.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fsSync.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function saveJson(filePath: string, data: unknown): void {
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  fsSync.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function appendJsonl(filePath: string, data: unknown): void {
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  fsSync.appendFileSync(filePath, JSON.stringify(data) + "\n", "utf-8");
}

function nowTs(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

type AnyObj = Record<string, any>;

function byName(items: AnyObj[]): Map<string, AnyObj> {
  const map = new Map<string, AnyObj>();
  for (const item of items) {
    const name = String(item.name ?? "").trim();
    if (name) map.set(name, item);
  }
  return map;
}

function mergeItem(base: AnyObj, patch: AnyObj): AnyObj {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "name") continue;
    merged[key] = value;
  }
  return merged;
}

// --- Patch application ---

function applyCharacterPatch(characters: AnyObj, patch: AnyObj): AnyObj {
  const items: AnyObj[] = characters.characters ?? [];
  const existing = byName(items);

  for (const item of (patch.add ?? []) as AnyObj[]) {
    const name = String(item.name ?? "").trim();
    if (!name) continue;
    existing.set(name, existing.has(name) ? mergeItem(existing.get(name)!, item) : item);
  }

  for (const item of (patch.update ?? []) as AnyObj[]) {
    const name = String(item.name ?? "").trim();
    if (!name) continue;
    existing.set(name, existing.has(name) ? mergeItem(existing.get(name)!, item) : item);
  }

  const protectedNames = new Set<string>();
  for (const [n, v] of existing) {
    if (v.protected === true) protectedNames.add(n);
  }

  const toDelete = new Set<string>();
  for (const item of (patch.delete ?? []) as any[]) {
    const name = String(typeof item === "object" ? (item?.name ?? item) : item).trim();
    if (name && !protectedNames.has(name)) toDelete.add(name);
  }

  // Guardrail: major character shrink protection
  const majorsBefore = [...existing.values()].filter((v) => v.role === "main" || v.protected);
  const remaining = new Map<string, AnyObj>();
  for (const [n, v] of existing) {
    if (!toDelete.has(n)) remaining.set(n, v);
  }
  const majorsAfter = [...remaining.values()].filter((v) => v.role === "main" || v.protected);
  if (
    majorsBefore.length > 0 &&
    majorsAfter.length < Math.max(1, Math.floor(majorsBefore.length * 0.7))
  ) {
    throw new Error("character shrink validation failed (major characters drop)");
  }

  return { characters: [...remaining.values()] };
}

function applyWorldPatch(world: AnyObj, patch: AnyObj): AnyObj {
  const data: AnyObj = { ...(world.world ?? {}) };
  const protectedKeys = new Set<string>(world.protected_keys ?? []);

  const add = patch.add ?? {};
  if (typeof add === "object" && !Array.isArray(add)) {
    Object.assign(data, add);
  } else if (Array.isArray(add)) {
    for (const item of add) {
      if (typeof item === "object") Object.assign(data, item);
    }
  }

  const update = patch.update ?? {};
  if (typeof update === "object" && !Array.isArray(update)) {
    Object.assign(data, update);
  } else if (Array.isArray(update)) {
    for (const item of update) {
      if (typeof item === "object") Object.assign(data, item);
    }
  }

  for (const key of (patch.delete ?? []) as string[]) {
    if (typeof key === "string" && key in data && !protectedKeys.has(key)) {
      delete data[key];
    }
  }

  return { world: data, protected_keys: world.protected_keys ?? [] };
}

function applyPlotPatch(plot: AnyObj, patch: AnyObj): AnyObj {
  const threads: AnyObj[] = plot.threads ?? [];
  const byId = new Map<string, AnyObj>();
  for (const t of threads) {
    if (t.thread_id) byId.set(t.thread_id, t);
  }

  for (const item of (patch.add ?? []) as AnyObj[]) {
    if (!item.thread_id) continue;
    byId.set(item.thread_id, item);
  }

  for (const item of (patch.update ?? []) as AnyObj[]) {
    if (!item.thread_id) continue;
    const base = byId.get(item.thread_id) ?? {};
    byId.set(item.thread_id, { ...base, ...item });
  }

  for (const item of (patch.close ?? []) as any[]) {
    const tid = typeof item === "object" ? item?.thread_id : item;
    if (!tid) continue;
    const base = byId.get(tid) ?? { thread_id: tid };
    base.status = "closed";
    byId.set(tid, base);
  }

  return { threads: [...byId.values()] };
}

// --- Main ---

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      patch: { type: "string" },
      chapter: { type: "string" },
      title: { type: "string" },
      summary: { type: "string", default: "" },
    },
    strict: true,
  });

  const project = values.project;
  const patchFile = values.patch;
  const chapter = values.chapter ? parseInt(values.chapter, 10) : undefined;
  const title = values.title;

  if (!project || !patchFile || chapter === undefined || !title) {
    console.error("--project, --patch, --chapter, --title are all required");
    process.exit(1);
  }

  if (!fsSync.existsSync(patchFile)) {
    console.error(`patch file not found: ${patchFile}`);
    process.exit(1);
  }

  const pDir = projectDir(project);
  const patchData: AnyObj = JSON.parse(fsSync.readFileSync(patchFile, "utf-8"));

  // --- Backup current state ---
  const charPath = memPath(project, "characters.json");
  const worldPath = memPath(project, "world_bible.json");
  const plotPath = memPath(project, "plot_threads.json");
  const timelinePath = memPath(project, "timeline.jsonl");

  const charBackup = loadJson(charPath, { characters: [] });
  const worldBackup = loadJson(worldPath, { world: {}, protected_keys: [] });
  const plotBackup = loadJson(plotPath, { threads: [] });

  try {
    // --- Apply patches ---
    const newChars = applyCharacterPatch(charBackup, patchData.characters ?? {});
    const newWorld = applyWorldPatch(worldBackup, patchData.world_bible ?? {});
    const newPlot = applyPlotPatch(plotBackup, patchData.plot_threads ?? {});

    saveJson(charPath, newChars);
    saveJson(worldPath, newWorld);
    saveJson(plotPath, newPlot);

    // --- Append timeline entry ---
    const tlPatch = patchData.timeline ?? {};
    const timelineEntry: AnyObj = {
      chapter,
      title,
      summary: tlPatch.summary || values.summary || "",
      events: tlPatch.events ?? [],
      consequences: tlPatch.consequences ?? [],
      pov: tlPatch.pov ?? "",
      locations: tlPatch.locations ?? [],
      characters: tlPatch.characters ?? [],
      updated_at: nowTs(),
    };
    appendJsonl(timelinePath, timelineEntry);

    // --- Auto-index timeline entry into verso memory DB ---
    try {
      const store = await NovelMemoryStore.open({
        dbPath: timelineDbPath(project),
        source: "timeline",
      });

      // Build markdown for the new entry
      const parts: string[] = [];
      let heading = `## Chapter ${chapter}`;
      if (title) heading += ` — ${title}`;
      parts.push(heading);
      if (timelineEntry.pov) parts.push(`POV: ${timelineEntry.pov}`);
      if (timelineEntry.locations?.length)
        parts.push(`Locations: ${timelineEntry.locations.join(", ")}`);
      if (timelineEntry.characters?.length)
        parts.push(`Characters: ${timelineEntry.characters.join(", ")}`);
      parts.push("");
      if (timelineEntry.summary) parts.push(timelineEntry.summary);
      if (timelineEntry.events?.length)
        parts.push("", `Events: ${timelineEntry.events.join("; ")}`);
      if (timelineEntry.consequences?.length)
        parts.push(`Consequences: ${timelineEntry.consequences.join("; ")}`);

      const markdown = parts.join("\n");

      // Count existing entries to determine index
      const stats = store.stats();
      const entryIndex = stats.files;
      const virtualPath = `timeline/entry-${String(entryIndex).padStart(5, "0")}`;

      await store.indexContent({ virtualPath, content: markdown });
      store.close();

      console.error(`Timeline entry indexed: ${virtualPath}`);
    } catch (err) {
      console.error(`Warning: timeline auto-index failed: ${err}`);
      // Non-fatal — JSON memory is already saved
    }

    // --- Update state.json ---
    const statePath = path.join(pDir, "state.json");
    const state: AnyObj = loadJson(statePath, {});
    const written: AnyObj[] = Array.isArray(state.chapters_written) ? state.chapters_written : [];
    const existingEntries = new Set(written.map((w) => `${w.chapter}:${w.title}`));
    if (!existingEntries.has(`${chapter}:${title}`)) {
      written.push({ chapter, title });
    }
    state.last_chapter = chapter;
    state.last_title = title;
    state.updated_at = nowTs();
    state.chapters_written = written;
    saveJson(statePath, state);

    console.log(JSON.stringify({ status: "ok", state }, null, 2));
  } catch (err) {
    // --- Rollback on failure ---
    console.error(`Patch failed, rolling back: ${err}`);
    saveJson(charPath, charBackup);
    saveJson(worldPath, worldBackup);
    saveJson(plotPath, plotBackup);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
