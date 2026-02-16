/**
 * runner.ts
 * Integrated evolver runner. Replaces skills/evolver-1.10.0/index.js and scripts/evolver-daemon.ts.
 * Runs the evolution cycle directly from src/ without spawning external skill processes.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const logger = createSubsystemLogger("evolver-runner");

// ---------- Types ----------

export type EvolverRunMode = "single" | "loop" | "solidify";

export type EvolverRunOptions = {
  mode: EvolverRunMode;
  review?: boolean;
  dryRun?: boolean;
  workspace?: string;
  verifyCmd?: string;
  rollbackEnabled?: boolean;
  cleanEnabled?: boolean;
  /** If true, src/ changes require user approval before deploy. */
  requireReview?: boolean;
  /** Model string from main session (e.g. "anthropic/claude-opus-4-6"). */
  model?: string;
  /** Agent dir path for auth store access (resolves auth on demand, not snapshotted). */
  agentDir?: string;
  /** Code agent function for making code modifications. */
  codeAgent?: (params: { prompt: string; workspace: string }) => Promise<CodeAgentResult>;
};

export type CodeAgentResult = {
  ok: boolean;
  filesChanged?: string[];
  error?: string;
};

export type RunCycleResult = {
  ok: boolean;
  error?: string;
  elapsed?: number;
};

// ---------- Helpers ----------

function getEvolverRoot(): string {
  return path.resolve(__dirname);
}

function getWorkspaceRoot(override?: string): string {
  if (override) {
    return override;
  }
  return (
    process.env.VERSO_WORKSPACE ||
    process.env.OPENCLAW_WORKSPACE ||
    path.resolve(__dirname, "..", "..")
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleepMs(ms: number): Promise<void> {
  const t = Math.max(0, ms);
  return new Promise((resolve) => setTimeout(resolve, t));
}

function readJsonSafe(p: string): unknown {
  try {
    if (!fs.existsSync(p)) {
      return null;
    }
    const raw = fs.readFileSync(p, "utf8");
    if (!raw.trim()) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isPendingSolidify(state: unknown): boolean {
  const s = state as { last_run?: { run_id?: string }; last_solidify?: { run_id?: string } } | null;
  const lastRun = s?.last_run ?? null;
  const lastSolid = s?.last_solidify ?? null;
  if (!lastRun?.run_id) {
    return false;
  }
  if (!lastSolid?.run_id) {
    return true;
  }
  return String(lastSolid.run_id) !== String(lastRun.run_id);
}

function parseMs(v: string | number | undefined | null, fallback: number): number {
  const n = parseInt(String(v == null ? "" : v), 10);
  if (Number.isFinite(n)) {
    return Math.max(0, n);
  }
  return fallback;
}

// ---------- Core Evolution Cycle ----------

/**
 * Run a single evolution cycle using the integrated evolve.js module.
 */
export async function runEvolutionCycle(options: EvolverRunOptions): Promise<RunCycleResult> {
  const workspace = getWorkspaceRoot(options.workspace);
  const _evolverRoot = getEvolverRoot();
  const t0 = Date.now();

  try {
    // Set environment for the evolve module
    process.env.OPENCLAW_WORKSPACE = workspace;
    process.env.VERSO_WORKSPACE = workspace;
    if (!process.env.MEMORY_DIR) {
      process.env.MEMORY_DIR = path.join(workspace, "memory");
    }
    // Propagate model/auth references so evolve module can use them
    if (options.model) {
      process.env.EVOLVER_MODEL = options.model;
    }
    if (options.agentDir) {
      process.env.EVOLVER_AGENT_DIR = options.agentDir;
    }

    // Import and run the evolve module
    const evolve = (await import("./evolve.js")) as { run: () => Promise<void> };
    await evolve.run();

    const elapsed = Date.now() - t0;
    logger.info("evolver-runner: cycle completed", { elapsed_ms: elapsed });

    // After evolution, if code agent is available and there are pending changes, use it
    if (options.codeAgent) {
      await applyCodeAgentChanges(options);
    }

    return { ok: true, elapsed };
  } catch (error) {
    const elapsed = Date.now() - t0;
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn("evolver-runner: cycle failed", { error: msg, elapsed_ms: elapsed });
    return { ok: false, error: msg, elapsed };
  }
}

/**
 * Run solidify (apply changes after evolution).
 */
export async function runSolidify(options: {
  dryRun?: boolean;
  noRollback?: boolean;
  intent?: string;
  summary?: string;
}): Promise<{ ok: boolean; gene?: unknown; event?: unknown; capsule?: unknown }> {
  try {
    const { solidify } = (await import("./gep/solidify.js")) as {
      solidify: (params: {
        intent?: string;
        summary?: string;
        dryRun?: boolean;
        rollbackOnFailure?: boolean;
      }) => { ok: boolean; gene?: unknown; event?: unknown; capsule?: unknown };
    };

    return solidify({
      intent: options.intent,
      summary: options.summary,
      dryRun: options.dryRun,
      rollbackOnFailure: !options.noRollback,
    });
  } catch (error) {
    logger.warn("evolver-runner: solidify failed", { error: String(error) });
    return { ok: false };
  }
}

// ---------- Code Agent Integration ----------

async function applyCodeAgentChanges(options: EvolverRunOptions): Promise<void> {
  if (!options.codeAgent) {
    return;
  }

  const workspace = getWorkspaceRoot(options.workspace);

  // Check if there are uncommitted changes from the evolution cycle
  const statusResult = spawnSync("git", ["status", "--porcelain"], {
    cwd: workspace,
    encoding: "utf-8",
  });

  const changedFiles = (statusResult.stdout ?? "").trim().split("\n").filter(Boolean);

  if (changedFiles.length === 0) {
    return;
  }

  // If src/ files were changed, use code agent for validation/enhancement
  const srcChanges = changedFiles.filter((line) => line.includes("src/"));
  if (srcChanges.length === 0) {
    return;
  }

  logger.info("evolver-runner: src/ changes detected, invoking code agent", {
    fileCount: srcChanges.length,
  });

  const prompt = `The evolver has made changes to the following src/ files:\n${srcChanges.join("\n")}\n\nPlease review these changes, fix any TypeScript errors, ensure the code compiles, and run basic validation.`;

  try {
    const result = await options.codeAgent({ prompt, workspace });
    if (!result.ok) {
      logger.warn("evolver-runner: code agent reported issues", { error: result.error });
    }
  } catch (error) {
    logger.warn("evolver-runner: code agent failed", { error: String(error) });
  }
}

// ---------- Verify & Rollback ----------

function runVerify(
  workspace: string,
  verifyCmd: string,
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(verifyCmd, {
    cwd: workspace,
    shell: true,
    encoding: "utf-8",
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function rollbackChanges(workspace: string, cleanEnabled: boolean): void {
  spawnSync("git", ["restore", "--staged", "--worktree", "."], {
    cwd: workspace,
    encoding: "utf-8",
  });
  if (cleanEnabled) {
    spawnSync("git", ["clean", "-fd"], {
      cwd: workspace,
      encoding: "utf-8",
    });
  }
  logger.info("evolver-runner: rollback completed");
}

function appendErrorRecord(workspace: string, errorType: string, details: unknown): void {
  const errorsPath = path.join(getEvolverRoot(), "assets", "gep", "errors.jsonl");
  const dir = path.dirname(errorsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const record = {
    type: "ErrorRecord",
    timestamp: nowIso(),
    error_type: errorType,
    details,
  };
  fs.appendFileSync(errorsPath, JSON.stringify(record) + "\n");
}

// ---------- Auto-Deploy (Local Git Commit) ----------

function autoCommitChanges(workspace: string): void {
  // Check if there are changes to commit
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: workspace,
    encoding: "utf-8",
  });
  const changes = (status.stdout ?? "").trim();
  if (!changes) {
    logger.info("evolver-runner: no changes to commit");
    return;
  }

  // Build a summary from changed files
  const files = changes
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^.{3}/, "").trim());
  const fileCount = files.length;
  const summary =
    fileCount <= 5 ? files.join(", ") : `${files.slice(0, 3).join(", ")} and ${fileCount - 3} more`;

  // Stage all changes
  const addResult = spawnSync("git", ["add", "-A"], {
    cwd: workspace,
    encoding: "utf-8",
  });
  if (addResult.status !== 0) {
    logger.warn("evolver-runner: git add failed", { stderr: addResult.stderr });
    return;
  }

  // Commit with evolver prefix
  const message = `evolve: auto-deploy ${fileCount} file(s) — ${summary}`;
  const commitResult = spawnSync("git", ["commit", "-m", message], {
    cwd: workspace,
    encoding: "utf-8",
  });
  if (commitResult.status !== 0) {
    logger.warn("evolver-runner: git commit failed", { stderr: commitResult.stderr });
    return;
  }

  logger.info("evolver-runner: auto-deployed", { files: fileCount, message });
}

// ---------- Daemon Loop ----------

/**
 * Run the evolver in continuous daemon loop mode.
 * This replaces both index.js --loop and scripts/evolver-daemon.ts.
 */
export async function runDaemonLoop(options: EvolverRunOptions): Promise<never> {
  const workspace = getWorkspaceRoot(options.workspace);
  const verifyCmd = options.verifyCmd ?? "pnpm lint && pnpm build && pnpm vitest run";
  const rollbackEnabled = options.rollbackEnabled ?? true;
  const cleanEnabled = options.cleanEnabled ?? true;
  const reviewMode = options.review ?? false;

  const minSleepMs = parseMs(process.env.EVOLVER_MIN_SLEEP_MS, 2000);
  const maxSleepMs = parseMs(process.env.EVOLVER_MAX_SLEEP_MS, 300000);
  const idleThresholdMs = parseMs(process.env.EVOLVER_IDLE_THRESHOLD_MS, 500);
  const pendingSleepMs = parseMs(process.env.EVOLVE_PENDING_SLEEP_MS, 120000);
  const maxCyclesPerProcess = parseMs(process.env.EVOLVER_MAX_CYCLES_PER_PROCESS, 100) || 100;
  const maxRssMb = parseMs(process.env.EVOLVER_MAX_RSS_MB, 500) || 500;

  const solidifyStatePath = path.join(
    process.env.MEMORY_DIR || path.join(workspace, "memory"),
    "evolution",
    "evolution_solidify_state.json",
  );

  let currentSleepMs = minSleepMs;
  let cycleCount = 0;

  logger.info("evolver-runner: daemon loop started", {
    workspace,
    verifyCmd,
    model: options.model || "(default)",
    agentDir: options.agentDir || "(none)",
  });

  while (true) {
    cycleCount += 1;

    // Gate: do not run a new cycle while previous run is pending solidify
    const state = readJsonSafe(solidifyStatePath);
    if (isPendingSolidify(state)) {
      await sleepMs(Math.max(pendingSleepMs, minSleepMs));
      continue;
    }

    const result = await runEvolutionCycle(options);

    if (result.ok) {
      // Verify build after successful evolution
      const verify = runVerify(workspace, verifyCmd);
      if (verify.ok) {
        // Verification passed — auto-deploy locally (git commit) unless review mode
        if (!reviewMode) {
          autoCommitChanges(workspace);
        } else {
          logger.info("evolver-runner: verification passed, awaiting review (review mode on)");
        }
      } else if (rollbackEnabled) {
        rollbackChanges(workspace, cleanEnabled);
        appendErrorRecord(workspace, "verify_failed", {
          stdout: verify.stdout.slice(0, 2000),
          stderr: verify.stderr.slice(0, 2000),
        });
      }
    } else if (rollbackEnabled) {
      rollbackChanges(workspace, cleanEnabled);
      appendErrorRecord(workspace, "run_failed", { error: result.error });
    }

    // Adaptive sleep
    const elapsed = result.elapsed ?? 0;
    if (!result.ok || elapsed < idleThresholdMs) {
      currentSleepMs = Math.min(maxSleepMs, Math.max(minSleepMs, currentSleepMs * 2));
    } else {
      currentSleepMs = minSleepMs;
    }

    // Memory leak protection: restart process if limits exceeded
    const memMb = process.memoryUsage().rss / 1024 / 1024;
    if (cycleCount >= maxCyclesPerProcess || memMb > maxRssMb) {
      logger.info("evolver-runner: restarting (memory/cycle limit)", {
        cycles: cycleCount,
        rssMb: Math.round(memMb),
      });
      process.exit(0); // Parent supervisor will restart
    }

    // Jitter to avoid lockstep
    const jitter = Math.floor(Math.random() * 250);
    await sleepMs(currentSleepMs + jitter);
  }
}
