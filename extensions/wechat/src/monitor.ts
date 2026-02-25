import http from "node:http";
import type { WeChatMessageContext } from "./types.js";

export interface WeChatMonitorOptions {
  port: number;
  webhookPath: string;
  onMessage: (message: WeChatMessageContext) => void;
  log?: (msg: string) => void;
  abortSignal?: AbortSignal;
}

export async function startWeChatMonitor(
  opts: WeChatMonitorOptions,
): Promise<{ port: number; stop: () => void }> {
  const { port, webhookPath, onMessage, log, abortSignal } = opts;

  const server = http.createServer((req, res) => {
    const url = req.url?.split("?")[0] || "";
    if (url === webhookPath && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", () => {
        try {
          const payload = JSON.parse(body);
          const message = convertToMessageContext(payload);
          if (message) onMessage(message);
          res.writeHead(200).end("OK");
        } catch {
          res.writeHead(400).end("Bad Request");
        }
      });
    } else {
      res.writeHead(404).end("Not Found");
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, "0.0.0.0", () => {
      log?.(`Webhook server listening on 0.0.0.0:${port}, path: ${webhookPath}`);

      const stop = () => {
        server.close();
      };

      abortSignal?.addEventListener("abort", stop);
      resolve({ port, stop });
    });

    server.on("error", reject);
  });
}

function normalizePayload(payload: any): {
  messageType: string;
  wcId: string;
  fromUser: string;
  toUser?: string;
  fromGroup?: string;
  content: string;
  newMsgId?: string | number;
  timestamp?: number;
  raw: unknown;
} {
  const { messageType, wcId } = payload;

  // Proxy flat format: fromUser at top level
  if (payload.fromUser) {
    return {
      messageType,
      wcId,
      fromUser: payload.fromUser,
      toUser: payload.toUser,
      fromGroup: payload.fromGroup,
      content: payload.content ?? "",
      newMsgId: payload.newMsgId,
      timestamp: payload.timestamp,
      raw: payload,
    };
  }

  // 苍何服务云 raw format: fields nested under data
  const data = payload.data ?? {};
  return {
    messageType,
    wcId,
    fromUser: data.fromUser,
    toUser: data.toUser,
    fromGroup: data.fromGroup,
    content: data.content ?? "",
    newMsgId: data.newMsgId,
    timestamp: data.timestamp ?? payload.timestamp,
    raw: payload,
  };
}

function resolveMessageType(messageType: string): WeChatMessageContext["type"] {
  switch (messageType) {
    case "60001":
    case "80001":
      return "text";
    case "60002":
    case "80002":
      return "image";
    case "60003":
    case "80003":
      return "video";
    case "60004":
    case "80004":
      return "voice";
    case "60008":
    case "80008":
      return "file";
    default:
      return "unknown";
  }
}

function convertToMessageContext(payload: any): WeChatMessageContext | null {
  const { messageType } = payload;

  // Offline notification — skip
  if (messageType === "30000") return null;

  // Only handle known private/group message types (6xxxx / 8xxxx)
  if (!messageType || (!messageType.startsWith("6") && !messageType.startsWith("8"))) {
    return null;
  }

  const norm = normalizePayload(payload);
  if (!norm.fromUser) return null;

  const isGroup = messageType.startsWith("8");

  const result: WeChatMessageContext = {
    id: String(norm.newMsgId || Date.now()),
    type: resolveMessageType(messageType),
    sender: { id: norm.fromUser, name: norm.fromUser },
    recipient: { id: norm.wcId },
    content: norm.content,
    timestamp: norm.timestamp || Date.now(),
    threadId: isGroup ? norm.fromGroup || norm.fromUser : norm.fromUser,
    raw: norm.raw,
  };

  if (isGroup && norm.fromGroup) {
    result.group = { id: norm.fromGroup, name: "" };
  }

  return result;
}
