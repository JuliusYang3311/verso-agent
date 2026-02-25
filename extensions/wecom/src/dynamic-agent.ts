import type { WecomConfig } from "./types.js";

interface DynamicAgentConfig {
  enabled: boolean;
  dmCreateAgent: boolean;
  groupEnabled: boolean;
  groupRequireMention: boolean;
  groupMentionPatterns: string[];
}

export function getDynamicAgentConfig(config: {
  channels?: { wecom?: WecomConfig };
}): DynamicAgentConfig {
  const wecom = config?.channels?.wecom || {};
  return {
    enabled: wecom.dynamicAgents?.enabled !== false,
    dmCreateAgent: wecom.dm?.createAgentOnFirstMessage !== false,
    groupEnabled: wecom.groupChat?.enabled !== false,
    groupRequireMention: wecom.groupChat?.requireMention !== false,
    groupMentionPatterns: wecom.groupChat?.mentionPatterns || ["@"],
  };
}

export function generateAgentId(chatType: string, peerId: string): string {
  const sanitized = String(peerId)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
  return chatType === "group" ? `wecom-group-${sanitized}` : `wecom-dm-${sanitized}`;
}

export function shouldUseDynamicAgent(params: {
  chatType: string;
  config: Record<string, unknown>;
}): boolean {
  const dc = getDynamicAgentConfig(params.config as { channels?: { wecom?: WecomConfig } });
  if (!dc.enabled) return false;
  return params.chatType === "group" ? dc.groupEnabled : dc.dmCreateAgent;
}

export function shouldTriggerGroupResponse(
  content: string,
  config: Record<string, unknown>,
): boolean {
  const dc = getDynamicAgentConfig(config as { channels?: { wecom?: WecomConfig } });
  if (!dc.groupEnabled) return false;
  if (!dc.groupRequireMention) return true;
  for (const pattern of dc.groupMentionPatterns) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|(?<=\\s|[^\\w]))${escaped}`, "u").test(content)) return true;
  }
  return false;
}

export function extractGroupMessageContent(
  content: string,
  config: Record<string, unknown>,
): string {
  const dc = getDynamicAgentConfig(config as { channels?: { wecom?: WecomConfig } });
  let clean = content;
  for (const pattern of dc.groupMentionPatterns) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    clean = clean.replace(new RegExp(`(?:^|(?<=\\s))${escaped}\\S*\\s*`, "gu"), "");
  }
  return clean.trim();
}
