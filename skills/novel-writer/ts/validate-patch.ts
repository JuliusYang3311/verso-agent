#!/usr/bin/env npx tsx
/**
 * validate-patch.ts
 * Validate a patch JSON before applying it to memory.
 * Checks protected characters, world keys, and major character shrink.
 *
 * Replaces scripts/validate_patch.py.
 *
 * Usage:
 *   npx tsx skills/novel-writer/ts/validate-patch.ts \
 *     --project mynovel --patch patch.json
 */

import fsSync from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const PROJECTS_DIR = path.resolve(import.meta.dirname, "../projects");

type AnyObj = Record<string, any>;

function memPath(project: string, file: string): string {
  return path.join(PROJECTS_DIR, project, "memory", file);
}

function loadJson(filePath: string, fallback: unknown): any {
  if (!fsSync.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fsSync.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function byName(items: AnyObj[]): Map<string, AnyObj> {
  const map = new Map<string, AnyObj>();
  for (const item of items) {
    const name = String(item.name ?? "").trim();
    if (name) map.set(name, item);
  }
  return map;
}

function validateCharacters(current: AnyObj, patch: AnyObj): void {
  const items: AnyObj[] = current.characters ?? [];
  const existing = byName(items);

  const toDelete = new Set<string>();
  for (const item of (patch.delete ?? []) as any[]) {
    const name = String(typeof item === "object" ? (item?.name ?? item) : item).trim();
    if (name) toDelete.add(name);
  }

  const protectedNames = new Set<string>();
  for (const [n, v] of existing) {
    if (v.protected === true) protectedNames.add(n);
  }

  const illegal = [...toDelete].filter((n) => protectedNames.has(n));
  if (illegal.length > 0) {
    throw new Error(`cannot delete protected characters: ${illegal.sort().join(", ")}`);
  }

  // Simulate patch to check major shrink
  for (const item of (patch.add ?? []) as AnyObj[]) {
    const name = String(item.name ?? "").trim();
    if (name) existing.set(name, { ...existing.get(name), ...item });
  }
  for (const item of (patch.update ?? []) as AnyObj[]) {
    const name = String(item.name ?? "").trim();
    if (name) existing.set(name, { ...existing.get(name), ...item });
  }
  for (const name of toDelete) {
    if (!protectedNames.has(name)) existing.delete(name);
  }

  const majorsBefore = items.filter((v) => v.role === "main" || v.protected);
  const majorsAfter = [...existing.values()].filter((v) => v.role === "main" || v.protected);
  if (
    majorsBefore.length > 0 &&
    majorsAfter.length < Math.max(1, Math.floor(majorsBefore.length * 0.7))
  ) {
    throw new Error("character shrink validation failed (major characters drop)");
  }
}

function validateWorld(current: AnyObj, patch: AnyObj): void {
  const protectedKeys = new Set<string>(current.protected_keys ?? []);
  const toDelete = (patch.delete ?? []) as string[];
  const illegal = toDelete.filter((key) => typeof key === "string" && protectedKeys.has(key));
  if (illegal.length > 0) {
    throw new Error(`cannot delete protected world keys: ${illegal.sort().join(", ")}`);
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      patch: { type: "string" },
    },
    strict: true,
  });

  if (!values.project || !values.patch) {
    console.error("--project and --patch are required");
    process.exit(1);
  }

  const patchFile = values.patch;
  if (!fsSync.existsSync(patchFile)) {
    console.error(`patch file not found: ${patchFile}`);
    process.exit(1);
  }

  const patchData: AnyObj = JSON.parse(fsSync.readFileSync(patchFile, "utf-8"));
  const characters = loadJson(memPath(values.project, "characters.json"), { characters: [] });
  const world = loadJson(memPath(values.project, "world_bible.json"), {
    world: {},
    protected_keys: [],
  });

  try {
    validateCharacters(characters, patchData.characters ?? {});
    validateWorld(world, patchData.world_bible ?? {});
    console.log(JSON.stringify({ status: "ok" }));
  } catch (err) {
    console.error(`Validation failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main();
