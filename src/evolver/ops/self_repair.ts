// Git Self-Repair - Evolver Core Module
// Emergency repair for git sync failures: abort rebase/merge, remove stale locks.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getWorkspaceRoot } from "../gep/paths.js";

const LOCK_MAX_AGE_MS: number = 10 * 60 * 1000; // 10 minutes

export type RepairAction = "rebase_aborted" | "merge_aborted" | "stale_lock_removed" | "fetch_ok";

export function repair(gitRoot?: string): RepairAction[] {
  const root = gitRoot || getWorkspaceRoot();
  const repaired: RepairAction[] = [];

  // 1. Abort pending rebase
  try {
    execSync("git rebase --abort", { cwd: root, stdio: "ignore" });
    repaired.push("rebase_aborted");
    console.log("[SelfRepair] Aborted pending rebase.");
  } catch (_e: unknown) {
    // intentionally ignored
  }

  // 2. Abort pending merge
  try {
    execSync("git merge --abort", { cwd: root, stdio: "ignore" });
    repaired.push("merge_aborted");
    console.log("[SelfRepair] Aborted pending merge.");
  } catch (_e: unknown) {
    // intentionally ignored
  }

  // 3. Remove stale index.lock
  const lockFile = path.join(root, ".git", "index.lock");
  if (fs.existsSync(lockFile)) {
    try {
      const stat = fs.statSync(lockFile);
      const age = Date.now() - stat.mtimeMs;
      if (age > LOCK_MAX_AGE_MS) {
        fs.unlinkSync(lockFile);
        repaired.push("stale_lock_removed");
        console.log(
          "[SelfRepair] Removed stale index.lock (" + Math.round(age / 60000) + "min old).",
        );
      }
    } catch (_e: unknown) {
      // intentionally ignored
    }
  }

  // 4. Fetch origin (safe, read-only)
  try {
    execSync("git fetch origin", { cwd: root, stdio: "ignore", timeout: 30000 });
    repaired.push("fetch_ok");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[SelfRepair] git fetch failed: " + msg);
  }

  return repaired;
}
