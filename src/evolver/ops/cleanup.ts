// GEP Artifact Cleanup - Evolver Core Module
// Removes old gep_prompt_*.json/txt files from evolution dir.
// Keeps at least 10 most recent files regardless of age.

import fs from "node:fs";
import path from "node:path";
import { getEvolutionDir } from "../gep/paths.js";

const MAX_AGE_MS: number = 24 * 60 * 60 * 1000; // 24 hours
const MIN_KEEP: number = 10;

interface FileEntry {
  name: string;
  path: string;
  mtime: number;
}

export function run(): number {
  const evoDir = getEvolutionDir();
  if (!fs.existsSync(evoDir)) {
    return 0;
  }

  const files: FileEntry[] = fs
    .readdirSync(evoDir)
    .filter((f: string) => /^gep_prompt_.*\.(json|txt)$/.test(f))
    .map((f: string) => {
      const full = path.join(evoDir, f);
      const stat = fs.statSync(full);
      return { name: f, path: full, mtime: stat.mtimeMs };
    })
    .toSorted((a: FileEntry, b: FileEntry) => b.mtime - a.mtime); // newest first

  const now = Date.now();
  let deleted = 0;

  for (let i = MIN_KEEP; i < files.length; i++) {
    if (now - files[i].mtime > MAX_AGE_MS) {
      try {
        fs.unlinkSync(files[i].path);
        deleted++;
      } catch {
        // intentionally ignored
      }
    }
  }

  if (deleted > 0) {
    console.log("[Cleanup] Deleted " + deleted + " old GEP artifacts.");
  }
  return deleted;
}
