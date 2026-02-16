import crypto from "node:crypto";
import type { VersoConfig } from "../../config/config.js";
import { loadSessionStore, resolveStorePath, type SessionEntry } from "../../config/sessions.js";
import { resolveAgentMainSessionKey } from "../../config/sessions/main-session.js";

export function resolveCronSession(params: {
  cfg: VersoConfig;
  sessionKey: string;
  nowMs: number;
  agentId: string;
}) {
  const sessionCfg = params.cfg.session;
  const storePath = resolveStorePath(sessionCfg?.store, {
    agentId: params.agentId,
  });
  const store = loadSessionStore(storePath);
  const entry = store[params.sessionKey];

  // Dynamically read auth/model/profile from the MAIN session at execution
  // time. This is critical for OAuth tokens that get refreshed, and for
  // auth profile / provider changes the user makes in the main session.
  const mainSessionKey = resolveAgentMainSessionKey({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  const mainEntry = mainSessionKey !== params.sessionKey ? store[mainSessionKey] : undefined;

  const sessionId = crypto.randomUUID();
  const systemSent = false;
  const sessionEntry: SessionEntry = {
    sessionId,
    updatedAt: params.nowMs,
    systemSent,
    thinkingLevel: entry?.thinkingLevel,
    verboseLevel: entry?.verboseLevel,
    // Auth-related fields: prefer main session (dynamic refresh) over cron entry (stale snapshot)
    model: mainEntry?.model ?? entry?.model,
    modelProvider: mainEntry?.modelProvider ?? entry?.modelProvider,
    providerOverride: mainEntry?.providerOverride ?? entry?.providerOverride,
    authProfileOverride: mainEntry?.authProfileOverride ?? entry?.authProfileOverride,
    authProfileOverrideSource:
      mainEntry?.authProfileOverrideSource ?? entry?.authProfileOverrideSource,
    contextTokens: mainEntry?.contextTokens ?? entry?.contextTokens,
    sendPolicy: entry?.sendPolicy,
    lastChannel: mainEntry?.lastChannel ?? entry?.lastChannel,
    lastTo: mainEntry?.lastTo ?? entry?.lastTo,
    lastAccountId: mainEntry?.lastAccountId ?? entry?.lastAccountId,
    label: entry?.label,
    displayName: entry?.displayName,
    skillsSnapshot: entry?.skillsSnapshot,
  };
  return { storePath, store, sessionEntry, systemSent, isNewSession: true };
}
