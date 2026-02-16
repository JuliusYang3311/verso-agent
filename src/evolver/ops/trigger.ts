// Evolver Wake Trigger - Evolver Core Module
// Writes a signal file that the wrapper can poll to wake up immediately.

import fs from "node:fs";
import path from "node:path";
import { getWorkspaceRoot } from "../gep/paths.js";

const WAKE_FILE: string = path.join(getWorkspaceRoot(), "memory", "evolver_wake.signal");

export function send(): boolean {
  try {
    fs.writeFileSync(WAKE_FILE, "WAKE");
    console.log("[Trigger] Wake signal sent to " + WAKE_FILE);
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Trigger] Failed: " + msg);
    return false;
  }
}

export function clear(): void {
  try {
    if (fs.existsSync(WAKE_FILE)) {
      fs.unlinkSync(WAKE_FILE);
    }
  } catch {
    // intentionally ignored
  }
}

export function isPending(): boolean {
  return fs.existsSync(WAKE_FILE);
}
