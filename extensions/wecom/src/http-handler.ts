import type { IncomingMessage, ServerResponse } from "node:http";
import type { VersoConfig } from "verso/plugin-sdk";
import * as crypto from "node:crypto";
import type { ResolvedWecomAccount } from "./types.js";
import { bufferOrDispatch, getStreamMeta, clearMessageBuffers } from "./bot.js";
import { streamManager } from "./stream-manager.js";
import { THINKING_PLACEHOLDER } from "./types.js";
import { WECOM_DUPLICATE } from "./types.js";
import { WecomWebhook } from "./webhook.js";

interface WebhookTarget {
  path: string;
  account: ResolvedWecomAccount;
  config: VersoConfig;
}

const webhookTargets = new Map<string, WebhookTarget[]>();

function normalizeWebhookPath(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}

export function registerWebhookTarget(target: WebhookTarget): () => void {
  const key = normalizeWebhookPath(target.path);
  const entry = { ...target, path: key };
  webhookTargets.set(key, [...(webhookTargets.get(key) ?? []), entry]);
  return () => {
    const updated = (webhookTargets.get(key) ?? []).filter((e) => e !== entry);
    if (updated.length > 0) webhookTargets.set(key, updated);
    else webhookTargets.delete(key);
    clearMessageBuffers();
  };
}

export async function wecomHttpHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url || "", "http://localhost");
  const path = normalizeWebhookPath(url.pathname);
  const targets = webhookTargets.get(path);
  if (!targets?.length) return false;

  const query = Object.fromEntries(url.searchParams);
  const target = targets[0];

  // GET: URL Verification
  if (req.method === "GET") {
    const webhook = new WecomWebhook({
      token: target.account.token,
      encodingAesKey: target.account.encodingAesKey,
    });
    const echo = webhook.handleVerify(query);
    if (echo) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(echo);
      return true;
    }
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Verification failed");
    return true;
  }

  // POST: Message handling
  if (req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf-8");

    const webhook = new WecomWebhook({
      token: target.account.token,
      encodingAesKey: target.account.encodingAesKey,
    });
    const result = await webhook.handleMessage(query, body);

    if (result === WECOM_DUPLICATE) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("success");
      return true;
    }
    if (!result || typeof result === "symbol") {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad Request");
      return true;
    }

    // Text/image/mixed/file/location/link message
    if ("message" in result) {
      const { timestamp, nonce } = result.query;
      const streamId = `stream_${crypto.randomUUID()}`;
      streamManager.createStream(streamId);
      streamManager.appendStream(streamId, THINKING_PLACEHOLDER);

      const streamResponse = webhook.buildStreamResponse(
        streamId,
        THINKING_PLACEHOLDER,
        false,
        timestamp,
        nonce,
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(streamResponse);

      bufferOrDispatch({
        message: result.message,
        streamId,
        timestamp,
        nonce,
        account: target.account,
        config: target.config,
      });
      return true;
    }

    // Stream refresh (WeCom polling for updates)
    if ("stream" in result) {
      const { timestamp, nonce } = result.query;
      const streamId = result.stream.id;
      const stream = streamManager.getStream(streamId);

      if (!stream) {
        const resp = webhook.buildStreamResponse(streamId, "会话已过期", true, timestamp, nonce);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(resp);
        return true;
      }

      // Check idle timeout for finished main response
      const meta = getStreamMeta(streamId);
      if (meta?.mainResponseDone && !stream.finished) {
        if (Date.now() - stream.updatedAt > 10000) {
          await streamManager.finishStream(streamId);
        }
      }

      const resp = webhook.buildStreamResponse(
        streamId,
        stream.content,
        stream.finished,
        timestamp,
        nonce,
        stream.finished && stream.msgItem.length > 0 ? { msgItem: stream.msgItem } : {},
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(resp);

      if (stream.finished) {
        setTimeout(() => streamManager.deleteStream(streamId), 30_000);
      }
      return true;
    }

    // Event (e.g. enter_chat)
    if ("event" in result) {
      if (result.event?.event_type === "enter_chat") {
        const { timestamp, nonce } = result.query;
        const welcomeMessage = `你好！👋 我是 AI 助手。

你可以使用下面的指令管理会话：
• **/new** - 新建会话（清空上下文）
• **/compact** - 压缩会话（保留上下文摘要）
• **/help** - 查看更多命令

有什么我可以帮你的吗？`;

        const streamId = `welcome_${crypto.randomUUID()}`;
        streamManager.createStream(streamId);
        streamManager.appendStream(streamId, welcomeMessage);
        await streamManager.finishStream(streamId);

        const resp = webhook.buildStreamResponse(streamId, welcomeMessage, true, timestamp, nonce);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(resp);
        return true;
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("success");
      return true;
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("success");
    return true;
  }

  res.writeHead(405, { "Content-Type": "text/plain" });
  res.end("Method Not Allowed");
  return true;
}
