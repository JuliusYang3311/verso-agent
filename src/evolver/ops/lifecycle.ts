// Evolver Lifecycle Manager - Evolver Core Module
// Provides: start, stop, restart, status, log, health check
// The loop script to spawn is configurable via EVOLVER_LOOP_SCRIPT env var.

import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getRepoRoot, getWorkspaceRoot, getLogsDir } from "../gep/paths.js";

const WORKSPACE_ROOT: string = getWorkspaceRoot();
const LOG_FILE: string = path.join(getLogsDir(), "evolver_loop.log");
const PID_FILE: string = path.join(WORKSPACE_ROOT, "memory", "evolver_loop.pid");
const MAX_SILENCE_MS: number = 30 * 60 * 1000;

function getLoopScript(): string {
  // Prefer wrapper if exists, fallback to core evolver
  if (process.env.EVOLVER_LOOP_SCRIPT) {
    return process.env.EVOLVER_LOOP_SCRIPT;
  }
  const wrapper = path.join(WORKSPACE_ROOT, "skills/feishu-evolver-wrapper/index.js");
  if (fs.existsSync(wrapper)) {
    return wrapper;
  }
  return path.join(getRepoRoot(), "index.js");
}

// --- Process Discovery ---

export function getRunningPids(): number[] {
  try {
    const out = execSync("ps -e -o pid,args", { encoding: "utf8" });
    const pids: number[] = [];
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("PID")) {
        continue;
      }
      const parts = trimmed.split(/\s+/);
      const pid = parseInt(parts[0], 10);
      const cmd = parts.slice(1).join(" ");
      if (pid === process.pid) {
        continue;
      }
      if (cmd.includes("node") && cmd.includes("index.js") && cmd.includes("--loop")) {
        if (
          cmd.includes("feishu-evolver-wrapper") ||
          cmd.includes("skills/evolver") ||
          cmd.includes("evolver/daemon-entry")
        ) {
          pids.push(pid);
        }
      }
    }
    return [...new Set(pids)].filter(isPidRunning);
  } catch {
    return [];
  }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getCmdLine(pid: number): string | null {
  try {
    return execSync("ps -p " + pid + " -o args=", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// --- Lifecycle ---

export interface StartOptions {
  delayMs?: number;
}

export interface StartResult {
  status: "already_running" | "started";
  pids?: number[];
  pid?: number;
}

export function start(options?: StartOptions): StartResult {
  const delayMs = (options && options.delayMs) || 0;
  const pids = getRunningPids();
  if (pids.length > 0) {
    console.log("[Lifecycle] Already running (PIDs: " + pids.join(", ") + ").");
    return { status: "already_running", pids };
  }
  if (delayMs > 0) {
    execSync("sleep " + delayMs / 1000);
  }

  const script = getLoopScript();
  console.log("[Lifecycle] Starting: node " + path.relative(WORKSPACE_ROOT, script) + " --loop");

  const out = fs.openSync(LOG_FILE, "a");
  const err = fs.openSync(LOG_FILE, "a");

  const env: Record<string, string | undefined> = { ...process.env };
  const npmGlobal = path.join(process.env.HOME || "", ".npm-global/bin");
  if (env.PATH && !env.PATH.includes(npmGlobal)) {
    env.PATH = npmGlobal + ":" + env.PATH;
  }

  const child = spawn("node", [script, "--loop"], {
    detached: true,
    stdio: ["ignore", out, err],
    cwd: WORKSPACE_ROOT,
    env,
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log("[Lifecycle] Started PID " + child.pid);
  return { status: "started", pid: child.pid };
}

export interface StopResult {
  status: "not_running" | "stopped";
  killed?: number[];
}

export function stop(): StopResult {
  const pids = getRunningPids();
  if (pids.length === 0) {
    console.log("[Lifecycle] No running evolver loops found.");
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
    return { status: "not_running" };
  }
  for (let i = 0; i < pids.length; i++) {
    console.log("[Lifecycle] Stopping PID " + pids[i] + "...");
    try {
      process.kill(pids[i], "SIGTERM");
    } catch {
      // intentionally ignored
    }
  }
  let attempts = 0;
  while (getRunningPids().length > 0 && attempts < 10) {
    execSync("sleep 0.5");
    attempts++;
  }
  const remaining = getRunningPids();
  for (let j = 0; j < remaining.length; j++) {
    console.log("[Lifecycle] SIGKILL PID " + remaining[j]);
    try {
      process.kill(remaining[j], "SIGKILL");
    } catch {
      // intentionally ignored
    }
  }
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
  const evolverLock = path.join(getRepoRoot(), "evolver.pid");
  if (fs.existsSync(evolverLock)) {
    fs.unlinkSync(evolverLock);
  }
  console.log("[Lifecycle] All stopped.");
  return { status: "stopped", killed: pids };
}

export function restart(options?: StartOptions): StartResult {
  stop();
  return start({ delayMs: 2000, ...options });
}

export interface PidInfo {
  pid: number;
  cmd: string | null;
}

export interface StatusResult {
  running: boolean;
  pids?: PidInfo[];
  log?: string;
}

export function status(): StatusResult {
  const pids = getRunningPids();
  if (pids.length > 0) {
    return {
      running: true,
      pids: pids.map((p: number): PidInfo => ({ pid: p, cmd: getCmdLine(p) })),
      log: path.relative(WORKSPACE_ROOT, LOG_FILE),
    };
  }
  return { running: false };
}

export interface TailLogResult {
  file?: string;
  content?: string;
  error?: string;
}

export function tailLog(lines?: number): TailLogResult {
  if (!fs.existsSync(LOG_FILE)) {
    return { error: "No log file" };
  }
  try {
    return {
      file: path.relative(WORKSPACE_ROOT, LOG_FILE),
      content: execSync("tail -n " + (lines || 20) + ' "' + LOG_FILE + '"', { encoding: "utf8" }),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  }
}

export interface HealthResult {
  healthy: boolean;
  reason?: string;
  silenceMinutes?: number;
  pids?: number[];
}

export function checkHealth(): HealthResult {
  const pids = getRunningPids();
  if (pids.length === 0) {
    return { healthy: false, reason: "not_running" };
  }
  if (fs.existsSync(LOG_FILE)) {
    const silenceMs = Date.now() - fs.statSync(LOG_FILE).mtimeMs;
    if (silenceMs > MAX_SILENCE_MS) {
      return {
        healthy: false,
        reason: "stagnation",
        silenceMinutes: Math.round(silenceMs / 60000),
      };
    }
  }
  return { healthy: true, pids };
}
