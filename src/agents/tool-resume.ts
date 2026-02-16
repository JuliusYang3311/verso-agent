/**
 * tool-resume.ts
 * 异步工具执行的 Resume 逻辑。
 * 工具在沙盒中异步执行，agent 可继续回复用户。
 * 工具完成后触发 resume，消息 turn 不丢失。
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { createSubsystemLogger } from "../logging/subsystem.js";

const logger = createSubsystemLogger("tool-resume");

// ---------- 类型定义 ----------

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

// ---------- 状态管理 ----------

const activeRuns = new Map<string, AsyncToolRun>();
const pendingResults = new Map<string, AsyncToolRun>();
const resumeCallbacks: ResumeCallback[] = [];

// ---------- 消息队列（防止消息丢失） ----------

const messageQueue: AgentMessage[] = [];

/**
 * 将用户消息入队（工具执行期间收到的消息）
 */
export function enqueueMessage(message: AgentMessage): void {
  messageQueue.push(message);
  logger.debug("tool-resume: message enqueued", { queueLength: messageQueue.length });
}

/**
 * 获取并清空待处理消息队列
 */
export function drainMessageQueue(): AgentMessage[] {
  const messages = [...messageQueue];
  messageQueue.length = 0;
  return messages;
}

/**
 * 检查是否有待处理消息
 */
export function hasQueuedMessages(): boolean {
  return messageQueue.length > 0;
}

// ---------- 异步工具运行管理 ----------

/**
 * 注册一个异步工具运行
 */
export function registerAsyncRun(params: { toolCallId: string; toolName: string }): AsyncToolRun {
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

/**
 * 标记异步工具运行完成
 */
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
  pendingResults.set(runId, run);

  logger.info("tool-resume: async run completed", {
    id: runId,
    tool: run.toolName,
    elapsed_ms: run.completedAt - run.startedAt,
  });

  // 通知所有 resume 回调
  for (const callback of resumeCallbacks) {
    try {
      void callback(run);
    } catch (e) {
      logger.warn("tool-resume: callback error", { error: String(e) });
    }
  }
}

/**
 * 标记异步工具运行失败
 */
export function failAsyncRun(runId: string, error: string): void {
  const run = activeRuns.get(runId);
  if (!run) {
    return;
  }

  run.status = "failed";
  run.error = error;
  run.completedAt = Date.now();

  activeRuns.delete(runId);
  pendingResults.set(runId, run);

  logger.info("tool-resume: async run failed", { id: runId, error });

  for (const callback of resumeCallbacks) {
    try {
      void callback(run);
    } catch {}
  }
}

// ---------- Resume 回调 ----------

/**
 * 注册 resume 回调（当异步工具完成时调用）
 */
export function onAsyncComplete(callback: ResumeCallback): () => void {
  resumeCallbacks.push(callback);
  return () => {
    const idx = resumeCallbacks.indexOf(callback);
    if (idx >= 0) {
      resumeCallbacks.splice(idx, 1);
    }
  };
}

// ---------- 查询 ----------

/**
 * 获取所有活跃的异步运行
 */
export function getActiveRuns(): AsyncToolRun[] {
  return Array.from(activeRuns.values());
}

/**
 * 获取并消费待处理的完成结果
 */
export function consumePendingResults(): AsyncToolRun[] {
  const results = Array.from(pendingResults.values());
  pendingResults.clear();
  return results;
}

/**
 * 是否有活跃的异步工具在运行
 */
export function hasActiveRuns(): boolean {
  return activeRuns.size > 0;
}

/**
 * 重置（用于测试）
 */
export function resetToolResumeForTests(): void {
  activeRuns.clear();
  pendingResults.clear();
  messageQueue.length = 0;
  resumeCallbacks.length = 0;
}
