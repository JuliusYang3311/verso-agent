import type { VersoConfig, PluginRuntime, RuntimeEnv } from "verso/plugin-sdk";
import type { WeChatMessageContext, ResolvedWeChatAccount } from "./types.js";
import { createWeChatReplyDispatcher } from "./reply-dispatcher.js";
import { getWeChatRuntime } from "./runtime.js";

// --- Message deduplication ---
const processedMessages = new Map<string, number>();
const DEDUP_WINDOW_MS = 30 * 60 * 1000;
const DEDUP_MAX_SIZE = 1000;
const DEDUP_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function tryRecordMessage(messageId: string): boolean {
  const now = Date.now();

  if (now - lastCleanup > DEDUP_CLEANUP_INTERVAL_MS) {
    lastCleanup = now;
    for (const [id, ts] of processedMessages) {
      if (now - ts > DEDUP_WINDOW_MS) processedMessages.delete(id);
    }
  }

  if (processedMessages.size >= DEDUP_MAX_SIZE) {
    const oldest = processedMessages.keys().next().value;
    if (oldest) processedMessages.delete(oldest);
  }

  if (processedMessages.has(messageId)) return false;
  processedMessages.set(messageId, now);
  return true;
}

export async function handleWeChatMessage(params: {
  cfg: VersoConfig;
  message: WeChatMessageContext;
  runtime: RuntimeEnv;
  accountId: string;
  account: ResolvedWeChatAccount;
}): Promise<void> {
  const { cfg, message, runtime, accountId, account } = params;
  const log = runtime.log ?? console.log;
  const error = runtime.error ?? console.error;

  if (!tryRecordMessage(message.id)) return;

  const isGroup = !!message.group;

  // Only handle text messages for now
  if (message.type !== "text") {
    log(`wechat[${accountId}]: ignoring non-text message type: ${message.type}`);
    return;
  }

  try {
    const core = getWeChatRuntime();

    const wechatFrom = `wechat:${message.sender.id}`;
    const wechatTo = isGroup ? `group:${message.group!.id}` : `user:${message.sender.id}`;
    const peerId = isGroup ? message.group!.id : message.sender.id;

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "wechat",
      accountId: account.accountId,
      peer: { kind: isGroup ? "group" : "direct", id: peerId },
    });

    const preview = message.content.replace(/\s+/g, " ").slice(0, 160);
    const inboundLabel = isGroup
      ? `WeChat[${accountId}] message in group ${message.group!.id}`
      : `WeChat[${accountId}] DM from ${message.sender.id}`;

    core.system.enqueueSystemEvent(`${inboundLabel}: ${preview}`, {
      sessionKey: route.sessionKey,
      contextKey: `wechat:message:${peerId}:${message.id}`,
    });

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);

    const speaker = message.sender.name || message.sender.id;
    const messageBody = `${speaker}: ${message.content}`;

    const envelopeFrom = isGroup ? `${message.group!.id}:${message.sender.id}` : message.sender.id;

    const body = core.channel.reply.formatAgentEnvelope({
      channel: "WeChat",
      from: envelopeFrom,
      timestamp: new Date(message.timestamp),
      envelope: envelopeOptions,
      body: messageBody,
    });

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: body,
      RawBody: message.content,
      CommandBody: message.content,
      From: wechatFrom,
      To: wechatTo,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isGroup ? "group" : "direct",
      GroupSubject: isGroup ? message.group!.id : undefined,
      SenderName: message.sender.name || message.sender.id,
      SenderId: message.sender.id,
      Provider: "wechat" as const,
      Surface: "wechat" as const,
      MessageSid: message.id,
      Timestamp: Date.now(),
      WasMentioned: false,
      CommandAuthorized: true,
      OriginatingChannel: "wechat" as const,
      OriginatingTo: wechatTo,
    });

    const replyTo = isGroup ? message.group!.id : message.sender.id;

    const { dispatcher, replyOptions, markDispatchIdle } = createWeChatReplyDispatcher({
      cfg,
      agentId: route.agentId,
      runtime,
      apiKey: account.apiKey,
      proxyUrl: account.proxyUrl,
      replyTo,
      accountId: account.accountId,
    });

    await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });

    markDispatchIdle();
  } catch (err) {
    error(`wechat[${accountId}]: failed to dispatch message: ${String(err)}`);
  }
}
