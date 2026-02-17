/**
 * tool-resume.ts
 * Async tool execution resume logic.
 * Tools execute asynchronously in sandbox; agent can continue replying.
 * On tool completion, resume is triggered so the turn is not lost.
 *
 * Resource safety:
 *   - activeRuns, pendingResults, messageQueue are all bounded
 *   - Stale runs auto-reaped every 60 s (MAX_RUN_AGE_MS = 30 min)
 *   - resumeCallbacks capped at MAX_CALLBACKS
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { createSubsystemLogger } from "../logging/subsystem.js";

const logger = createSubsystemLogger("tool-resume");

// ---------- Limits ----------

const MAX_ACTIVE_RUNS = 50;
const MAX_PENDING_RESULTS = 100;
const MAX_QUEUED_MESSAGES = 200;
const MAX_CALLBACKS = 50;
const MAX_RUN_AGE_MS = 30 * 60 * 1000; // 30 minutes
const REAP_INTERVAL_MS = 60_000;

// ---------- Types ----------

export type AsyncToolRun = {
  id: string;
  toolCallId: string;
  toolName: string;
  startedAt: number;
  status: "running" | "completed" | "failed" | "cancelled";
  result?: unknown;
  error?: string;
  completedAt?: number;
};

export type ResumeCallback = (run: AsyncToolRun) => void | Promise<void>;

// ---------- State ----------

const activeRuns = new Map<string, AsyncToolRun>();
const pendingResults = new Map<string, AsyncToolRun>();
const resumeCallbacks: ResumeCallback[] = [];
const messageQueue: AgentMessage[] = [];

// ---------- Stale run reaper ----------

const reapTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, run] of activeRuns) {
    if (now - run.startedAt > MAX_RUN_AGE_MS) {
      logger.warn("tool-resume: reaping stale active run", { id, tool: run.toolName });
      run.status = "failed";
      run.error = "timeout: exceeded max run age";
      run.completedAt = now;
      activeRuns.delete(id);
    }
  }
  for (const [id, run] of pendingResults) {
    if (run.completedAt && now - run.completedAt > MAX_RUN_AGE_MS) {
      pendingResults.delete(id);
    }
  }
}, REAP_INTERVAL_MS);
reapTimer.unref?.();

// ---------- Message queue ----------

export function enqueueMessage(message: AgentMessage): void {
  if (messageQueue.length >= MAX_QUEUED_MESSAGES) {
    messageQueue.shift();
    logger.warn("tool-resume: message queue full, dropping oldest");
  }
  messageQueue.push(message);
  logger.debug("tool-resume: message enqueued", { queueLength: messageQueue.length });
}

export function drainMessageQueue(): AgentMessage[] {
  const messages = [...messageQueue];
  messageQueue.length = 0;
  return messages;
}

export function hasQueuedMessages(): boolean {
  return messageQueue.length > 0;
}

// ---------- Async run management ----------

export function registerAsyncRun(params: { toolCallId: string; toolName: string }): AsyncToolRun {
  if (activeRuns.size >= MAX_ACTIVE_RUNS) {
    // Evict oldest run
    const oldest = activeRuns.values().next().value as AsyncToolRun;
    logger.warn("tool-resume: active runs at limit, evicting oldest", { id: oldest.id });
    activeRuns.delete(oldest.id);
  }

  const run: AsyncToolRun = {
    id: `async_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    toolCallId: params.toolCallId,
    toolName: params.toolName,
    startedAt: Date.now(),
    status: "running",
  };

  activeRuns.set(run.id, run);
  logger.info("tool-resume: async run registered", { id: run.id, tool: run.toolName });
  return run;
}

export function completeAsyncRun(runId: string, result: unknown): void {
  const run = activeRuns.get(runId);
  if (!run) {
    logger.warn("tool-resume: run not found for completion", { runId });
    return;
  }

  run.status = "completed";
  run.result = result;
  run.completedAt = Date.now();

  activeRuns.delete(runId);

  // Evict oldest pending result if at limit
  if (pendingResults.size >= MAX_PENDING_RESULTS) {
    const oldestKey = pendingResults.keys().next().value as string;
    pendingResults.delete(oldestKey);
  }
  pendingResults.set(runId, run);

  logger.info("tool-resume: async run completed", {
    id: runId,
    tool: run.toolName,
    elapsed_ms: run.completedAt - run.startedAt,
  });

  for (const callback of resumeCallbacks) {
    try {
      void callback(run);
    } catch (e) {
      logger.warn("tool-resume: callback error", { error: String(e) });
    }
  }
}

export function failAsyncRun(runId: string, error: string): void {
  const run = activeRuns.get(runId);
  if (!run) {
    return;
  }

  run.status = "failed";
  run.error = error;
  run.completedAt = Date.now();

  activeRuns.delete(runId);

  if (pendingResults.size >= MAX_PENDING_RESULTS) {
    const oldestKey = pendingResults.keys().next().value as string;
    pendingResults.delete(oldestKey);
  }
  pendingResults.set(runId, run);

  logger.info("tool-resume: async run failed", { id: runId, error });

  for (const callback of resumeCallbacks) {
    try {
      void callback(run);
    } catch {}
  }
}

// ---------- Resume callbacks ----------

export function onAsyncComplete(callback: ResumeCallback): () => void {
  if (resumeCallbacks.length >= MAX_CALLBACKS) {
    logger.warn("tool-resume: callback limit reached, dropping oldest");
    resumeCallbacks.shift();
  }
  resumeCallbacks.push(callback);
  return () => {
    const idx = resumeCallbacks.indexOf(callback);
    if (idx >= 0) {
      resumeCallbacks.splice(idx, 1);
    }
  };
}

// ---------- Queries ----------

export function getActiveRuns(): AsyncToolRun[] {
  return Array.from(activeRuns.values());
}

export function consumePendingResults(): AsyncToolRun[] {
  const results = Array.from(pendingResults.values());
  pendingResults.clear();
  return results;
}

export function hasActiveRuns(): boolean {
  return activeRuns.size > 0;
}

export function resetToolResumeForTests(): void {
  activeRuns.clear();
  pendingResults.clear();
  messageQueue.length = 0;
  resumeCallbacks.length = 0;
}
