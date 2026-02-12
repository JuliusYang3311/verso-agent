import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { VersoConfig } from "../config/types.js";
import { resolveStateDir } from "../config/paths.js";

type EvolverStartResult = {
  started: boolean;
  pid?: number;
  logPath: string;
  error?: string;
};

type EvolverStopResult = {
  stopped: boolean;
  pid?: number;
};

type EvolverStatus = {
  running: boolean;
  pid?: number;
  logPath: string;
  rollbackPath: string;
};

const LOG_FILENAME = "evolver-daemon.log";
const PID_FILENAME = "evolver-daemon.pid";
const ROLLBACK_FILENAME = "evolver-daemon.rollback.json";

function ensureLogsDir(): string {
  const stateDir = resolveStateDir();
  const logsDir = path.join(stateDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  return logsDir;
}

function resolveLogPaths(): { logPath: string; pidPath: string; rollbackPath: string } {
  const logsDir = ensureLogsDir();
  return {
    logPath: path.join(logsDir, LOG_FILENAME),
    pidPath: path.join(logsDir, PID_FILENAME),
    rollbackPath: path.join(logsDir, ROLLBACK_FILENAME),
  };
}

function readPid(pidPath: string): number | null {
  try {
    const raw = fs.readFileSync(pidPath, "utf-8").trim();
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveWorkspace(cfg?: VersoConfig): string {
  const fromCfg = cfg?.evolver?.workspace?.trim();
  if (fromCfg) {
    return fromCfg;
  }
  return (
    cfg?.agents?.defaults?.workspace?.trim() || process.env.OPENCLAW_WORKSPACE || process.cwd()
  );
}

function resolveMemoryDir(workspace: string): string {
  const fromEnv = process.env.MEMORY_DIR?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return path.join(workspace, "memory");
}

function resolveEvolverDir(cfg?: VersoConfig): string | null {
  const fromCfg = cfg?.evolver?.dir?.trim();
  if (fromCfg) {
    return fromCfg;
  }
  const fromEnv = process.env.EVOLVER_DIR?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return "/Users/veso/Documents/verso/skills/evolver-1.10.0";
}

function resolveVerifyCmd(cfg?: VersoConfig): string {
  return cfg?.evolver?.verifyCmd?.trim() || process.env.EVOLVER_VERIFY_CMD || "pnpm build";
}

function resolveRunArgs(cfg?: VersoConfig): string {
  if (typeof cfg?.evolver?.review === "boolean") {
    return cfg.evolver.review ? "run --review" : "run";
  }
  const fromEnv = process.env.EVOLVER_RUN_ARGS?.trim();
  return fromEnv || "run";
}

function resolveBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["0", "false", "off", "no"].includes(normalized)) {
      return false;
    }
    if (["1", "true", "on", "yes"].includes(normalized)) {
      return true;
    }
  }
  return fallback;
}

export async function startEvolverDaemon(cfg?: VersoConfig): Promise<EvolverStartResult> {
  const { logPath, pidPath, rollbackPath } = resolveLogPaths();
  const existingPid = readPid(pidPath);
  if (existingPid && isPidAlive(existingPid)) {
    return { started: false, pid: existingPid, logPath };
  }

  const evolverDir = resolveEvolverDir(cfg);
  if (!evolverDir) {
    return {
      started: false,
      logPath,
      error:
        "Missing evolver directory. Set evolver.dir in config or EVOLVER_DIR environment variable.",
    };
  }

  const workspace = resolveWorkspace(cfg);
  const memoryDir = resolveMemoryDir(workspace);
  const verifyCmd = resolveVerifyCmd(cfg);
  const runArgs = resolveRunArgs(cfg);
  const rollbackEnabled = resolveBool(cfg?.evolver?.rollback ?? process.env.EVOLVER_ROLLBACK, true);
  const cleanEnabled = resolveBool(cfg?.evolver?.clean ?? process.env.EVOLVER_CLEAN, true);

  const scriptPath = path.join(process.cwd(), "scripts", "evolver-daemon.ts");
  const child = spawn(process.execPath, ["--import", "tsx", scriptPath], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      OPENCLAW_WORKSPACE: workspace,
      MEMORY_DIR: memoryDir,
      EVOLVER_DIR: evolverDir,
      EVOLVER_VERIFY_CMD: verifyCmd,
      EVOLVER_RUN_ARGS: runArgs,
      EVOLVER_ROLLBACK: rollbackEnabled ? "true" : "false",
      EVOLVER_CLEAN: cleanEnabled ? "true" : "false",
      EVOLVER_LOG_PATH: logPath,
      EVOLVER_ROLLBACK_REPORT_PATH: rollbackPath,
    },
  });
  child.unref();
  fs.writeFileSync(pidPath, String(child.pid));
  return { started: true, pid: child.pid, logPath };
}

export async function stopEvolverDaemon(): Promise<EvolverStopResult> {
  const { pidPath } = resolveLogPaths();
  const pid = readPid(pidPath);
  if (!pid) {
    return { stopped: false };
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore
  }
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // ignore
  }
  return { stopped: true, pid };
}

export async function getEvolverStatus(): Promise<EvolverStatus> {
  const { logPath, pidPath, rollbackPath } = resolveLogPaths();
  const pid = readPid(pidPath);
  const running = pid ? isPidAlive(pid) : false;
  return { running, pid: running ? (pid ?? undefined) : undefined, logPath, rollbackPath };
}

export async function readEvolverRollbackInfo(): Promise<string | null> {
  const { rollbackPath } = resolveLogPaths();
  try {
    const raw = fs.readFileSync(rollbackPath, "utf-8").trim();
    return raw ? raw : null;
  } catch {
    return null;
  }
}
