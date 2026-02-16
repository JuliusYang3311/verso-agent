/**
 * session-lock.ts
 * 单一 Session 锁定机制。
 * 每个 agent 只允许一个活跃 session。创建新 session 时销毁旧 session。
 * 不再支持 sub-agent spawn。
 */

import type { VersoConfig } from "../config/config.js";
import { resolveMainSessionKey } from "../config/sessions/main-session.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const logger = createSubsystemLogger("session-lock");

// 每个 agent 的当前活跃 session key
const activeSessionLock = new Map<string, { sessionKey: string; lockedAt: number }>();

/**
 * 获取 agent 的活跃 session key
 */
export function getActiveSession(agentId: string): string | null {
  const entry = activeSessionLock.get(agentId);
  return entry ? entry.sessionKey : null;
}

/**
 * 锁定 session：设置 agent 的唯一活跃 session。
 * 如果已有活跃 session，返回旧 session key 以供调用者清理。
 */
export function lockSession(
  agentId: string,
  sessionKey: string,
): { previousSessionKey: string | null } {
  const existing = activeSessionLock.get(agentId);
  const previousSessionKey = existing ? existing.sessionKey : null;

  if (previousSessionKey && previousSessionKey !== sessionKey) {
    logger.info(`session-lock: replacing session for agent=${agentId}`, {
      previous: previousSessionKey,
      new: sessionKey,
    });
  }

  activeSessionLock.set(agentId, { sessionKey, lockedAt: Date.now() });

  return { previousSessionKey: previousSessionKey !== sessionKey ? previousSessionKey : null };
}

/**
 * 释放 session 锁
 */
export function unlockSession(agentId: string): void {
  activeSessionLock.delete(agentId);
}

/**
 * 检查 session 是否为当前活跃 session
 */
export function isActiveSession(agentId: string, sessionKey: string): boolean {
  const entry = activeSessionLock.get(agentId);
  return entry ? entry.sessionKey === sessionKey : false;
}

/**
 * 获取所有活跃 session 的快照
 */
export function getActiveSessionSnapshot(): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const [agentId, entry] of activeSessionLock) {
    snapshot.set(agentId, entry.sessionKey);
  }
  return snapshot;
}

/**
 * 从配置中解析默认的 session key 并锁定
 */
export function initSessionLock(cfg?: VersoConfig): string {
  const mainKey = resolveMainSessionKey(cfg);
  const agentId = mainKey.split(":")[1] || "default";
  lockSession(agentId, mainKey);
  logger.info(`session-lock: initialized`, { agentId, sessionKey: mainKey });
  return mainKey;
}

/**
 * 重置所有锁（用于测试）
 */
export function resetSessionLockForTests(): void {
  activeSessionLock.clear();
}
