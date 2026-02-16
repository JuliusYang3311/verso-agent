// GEP A2A Protocol - Standard message types and pluggable transport layer.
//
// Protocol messages:
//   hello    - capability advertisement and node discovery
//   publish  - broadcast an eligible asset (Capsule/Gene)
//   fetch    - request a specific asset by id or content hash
//   report   - send a ValidationReport for a received asset
//   decision - accept/reject/quarantine decision on a received asset
//   revoke   - withdraw a previously published asset
//
// Transport interface:
//   send(message, opts)    - send a protocol message
//   receive(opts)          - receive pending messages
//   list(opts)             - list available message files/streams
//
// Default transport: FileTransport (reads/writes JSONL to a2a/ directory).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { computeAssetId } from "./contentHash.js";
import { captureEnvFingerprint } from "./envFingerprint.js";
import { getGepAssetsDir } from "./paths.js";

export const PROTOCOL_NAME = "gep-a2a";
export const PROTOCOL_VERSION = "1.0.0";
export const VALID_MESSAGE_TYPES = [
  "hello",
  "publish",
  "fetch",
  "report",
  "decision",
  "revoke",
] as const;

export type MessageType = (typeof VALID_MESSAGE_TYPES)[number];

export interface ProtocolMessage {
  protocol: string;
  protocol_version: string;
  message_type: MessageType;
  message_id: string;
  sender_id: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

interface BuildMessageParams {
  messageType: string;
  payload?: Record<string, unknown>;
  senderId?: string;
}

interface HelloOpts {
  nodeId?: string;
  capabilities?: Record<string, unknown>;
  geneCount?: number;
  capsuleCount?: number;
}

interface PublishOpts {
  nodeId?: string;
  asset: { type: string; id: string; asset_id?: string; [key: string]: unknown };
}

interface FetchOpts {
  nodeId?: string;
  assetType?: string | null;
  localId?: string | null;
  contentHash?: string | null;
}

interface ReportOpts {
  nodeId?: string;
  assetId?: string | null;
  localId?: string | null;
  validationReport?: unknown;
}

interface DecisionOpts {
  nodeId?: string;
  assetId?: string | null;
  localId?: string | null;
  decision: "accept" | "reject" | "quarantine";
  reason?: string | null;
}

interface RevokeOpts {
  nodeId?: string;
  assetId?: string | null;
  localId?: string | null;
  reason?: string | null;
}

interface TransportSendResult {
  ok: boolean;
  path?: string;
  response?: unknown;
  error?: string;
}

interface TransportOpts {
  dir?: string;
  hubUrl?: string;
  assetType?: string | null;
}

export interface Transport {
  send: (
    message: ProtocolMessage,
    opts?: TransportOpts,
  ) => TransportSendResult | Promise<TransportSendResult>;
  receive: (opts?: TransportOpts) => ProtocolMessage[] | Promise<ProtocolMessage[]>;
  list: (opts?: TransportOpts) => string[];
}

function generateMessageId(): string {
  return "msg_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");
}

export function getNodeId(): string {
  if (process.env.A2A_NODE_ID) {
    return String(process.env.A2A_NODE_ID);
  }
  const raw = process.cwd() + "|" + (process.env.AGENT_NAME || "default");
  return "node_" + crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

// --- Base message builder ---

export function buildMessage(params: BuildMessageParams): ProtocolMessage {
  const messageType = params.messageType;
  const payload = params.payload;
  const senderId = params.senderId;
  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new Error(
      "Invalid message type: " + messageType + ". Valid: " + VALID_MESSAGE_TYPES.join(", "),
    );
  }
  return {
    protocol: PROTOCOL_NAME,
    protocol_version: PROTOCOL_VERSION,
    message_type: messageType as MessageType,
    message_id: generateMessageId(),
    sender_id: senderId || getNodeId(),
    timestamp: new Date().toISOString(),
    payload: payload || {},
  };
}

// --- Typed message builders ---

export function buildHello(opts?: HelloOpts): ProtocolMessage {
  const o = opts || {};
  return buildMessage({
    messageType: "hello",
    senderId: o.nodeId,
    payload: {
      capabilities: o.capabilities || {},
      gene_count: typeof o.geneCount === "number" ? o.geneCount : null,
      capsule_count: typeof o.capsuleCount === "number" ? o.capsuleCount : null,
      env_fingerprint: captureEnvFingerprint(),
    },
  });
}

export function buildPublish(opts: PublishOpts): ProtocolMessage {
  const asset = opts.asset;
  if (!asset || !asset.type || !asset.id) {
    throw new Error("publish: asset must have type and id");
  }
  return buildMessage({
    messageType: "publish",
    senderId: opts.nodeId,
    payload: {
      asset_type: asset.type,
      asset_id: asset.asset_id || computeAssetId(asset as Record<string, unknown>),
      local_id: asset.id,
      asset: asset,
    },
  });
}

export function buildFetch(opts?: FetchOpts): ProtocolMessage {
  const o = opts || {};
  return buildMessage({
    messageType: "fetch",
    senderId: o.nodeId,
    payload: {
      asset_type: o.assetType || null,
      local_id: o.localId || null,
      content_hash: o.contentHash || null,
    },
  });
}

export function buildReport(opts?: ReportOpts): ProtocolMessage {
  const o = opts || {};
  return buildMessage({
    messageType: "report",
    senderId: o.nodeId,
    payload: {
      target_asset_id: o.assetId || null,
      target_local_id: o.localId || null,
      validation_report: o.validationReport || null,
    },
  });
}

export function buildDecision(opts: DecisionOpts): ProtocolMessage {
  const validDecisions = ["accept", "reject", "quarantine"];
  if (!validDecisions.includes(opts.decision)) {
    throw new Error("decision must be one of: " + validDecisions.join(", "));
  }
  return buildMessage({
    messageType: "decision",
    senderId: opts.nodeId,
    payload: {
      target_asset_id: opts.assetId || null,
      target_local_id: opts.localId || null,
      decision: opts.decision,
      reason: opts.reason || null,
    },
  });
}

export function buildRevoke(opts?: RevokeOpts): ProtocolMessage {
  const o = opts || {};
  return buildMessage({
    messageType: "revoke",
    senderId: o.nodeId,
    payload: {
      target_asset_id: o.assetId || null,
      target_local_id: o.localId || null,
      reason: o.reason || null,
    },
  });
}

// --- Validation ---

export function isValidProtocolMessage(msg: unknown): msg is ProtocolMessage {
  if (!msg || typeof msg !== "object") {
    return false;
  }
  const m = msg as Record<string, unknown>;
  if (m.protocol !== PROTOCOL_NAME) {
    return false;
  }
  if (
    !m.message_type ||
    !(VALID_MESSAGE_TYPES as readonly string[]).includes(m.message_type as string)
  ) {
    return false;
  }
  if (!m.message_id || typeof m.message_id !== "string") {
    return false;
  }
  if (!m.timestamp || typeof m.timestamp !== "string") {
    return false;
  }
  return true;
}

// Try to extract a raw asset from either a protocol message or a plain asset object.
// This enables backward-compatible ingestion of both old-format and new-format payloads.
export function unwrapAssetFromMessage(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const obj = input as Record<string, unknown>;
  // If it is a protocol message with a publish payload, extract the asset.
  if (obj.protocol === PROTOCOL_NAME && obj.message_type === "publish") {
    const p = obj.payload as Record<string, unknown> | undefined;
    if (p && p.asset && typeof p.asset === "object") {
      return p.asset as Record<string, unknown>;
    }
    return null;
  }
  // If it is a plain asset (Gene/Capsule/EvolutionEvent), return as-is.
  if (obj.type === "Gene" || obj.type === "Capsule" || obj.type === "EvolutionEvent") {
    return obj;
  }
  return null;
}

// --- File Transport ---

function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {
    // ignore
  }
}

function defaultA2ADir(): string {
  return process.env.A2A_DIR || path.join(getGepAssetsDir(), "a2a");
}

export function fileTransportSend(
  message: ProtocolMessage,
  opts?: TransportOpts,
): TransportSendResult {
  const dir = (opts && opts.dir) || defaultA2ADir();
  const subdir = path.join(dir, "outbox");
  ensureDir(subdir);
  const filePath = path.join(subdir, message.message_type + ".jsonl");
  fs.appendFileSync(filePath, JSON.stringify(message) + "\n", "utf8");
  return { ok: true, path: filePath };
}

export function fileTransportReceive(opts?: TransportOpts): ProtocolMessage[] {
  const dir = (opts && opts.dir) || defaultA2ADir();
  const subdir = path.join(dir, "inbox");
  if (!fs.existsSync(subdir)) {
    return [];
  }
  const files = fs.readdirSync(subdir).filter((f) => f.endsWith(".jsonl"));
  const messages: ProtocolMessage[] = [];
  for (let fi = 0; fi < files.length; fi++) {
    try {
      const raw = fs.readFileSync(path.join(subdir, files[fi]), "utf8");
      const lines = raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      for (let li = 0; li < lines.length; li++) {
        try {
          const msg = JSON.parse(lines[li]) as Record<string, unknown>;
          if (msg && msg.protocol === PROTOCOL_NAME) {
            messages.push(msg as unknown as ProtocolMessage);
          }
        } catch {
          // ignore parse errors
        }
      }
    } catch {
      // ignore file read errors
    }
  }
  return messages;
}

export function fileTransportList(opts?: TransportOpts): string[] {
  const dir = (opts && opts.dir) || defaultA2ADir();
  const subdir = path.join(dir, "outbox");
  if (!fs.existsSync(subdir)) {
    return [];
  }
  return fs.readdirSync(subdir).filter((f) => f.endsWith(".jsonl"));
}

// --- HTTP Transport (connects to evomap-hub) ---

export function httpTransportSend(
  message: ProtocolMessage,
  opts?: TransportOpts,
): Promise<TransportSendResult> {
  const hubUrl = (opts && opts.hubUrl) || process.env.A2A_HUB_URL;
  if (!hubUrl) {
    return Promise.resolve({ ok: false, error: "A2A_HUB_URL not set" });
  }
  const endpoint = hubUrl.replace(/\/+$/, "") + "/a2a/" + message.message_type;
  const body = JSON.stringify(message);
  // Use dynamic import for fetch (available in Node 18+)
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body,
  })
    .then((res) => res.json())
    .then((data) => ({ ok: true, response: data }))
    .catch((err: Error) => ({ ok: false, error: err.message }));
}

export function httpTransportReceive(opts?: TransportOpts): Promise<ProtocolMessage[]> {
  const hubUrl = (opts && opts.hubUrl) || process.env.A2A_HUB_URL;
  if (!hubUrl) {
    return Promise.resolve([]);
  }
  const assetType = (opts && opts.assetType) || null;
  const fetchMsg = buildFetch({ assetType });
  const endpoint = hubUrl.replace(/\/+$/, "") + "/a2a/fetch";
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fetchMsg),
  })
    .then((res) => res.json())
    .then((data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d && d.payload && Array.isArray((d.payload as Record<string, unknown>).results)) {
        return (d.payload as Record<string, unknown>).results as ProtocolMessage[];
      }
      return [];
    })
    .catch(() => []);
}

export function httpTransportList(): string[] {
  return ["http"];
}

// --- Transport registry ---

const transports: Record<string, Transport> = {
  file: {
    send: fileTransportSend,
    receive: fileTransportReceive,
    list: fileTransportList,
  },
  http: {
    send: httpTransportSend,
    receive: httpTransportReceive,
    list: httpTransportList,
  },
};

export function getTransport(name?: string): Transport {
  const n = String(name || process.env.A2A_TRANSPORT || "file").toLowerCase();
  const t = transports[n];
  if (!t) {
    throw new Error(
      "Unknown A2A transport: " + n + ". Available: " + Object.keys(transports).join(", "),
    );
  }
  return t;
}

export function registerTransport(name: string, impl: Transport): void {
  if (!name || typeof name !== "string") {
    throw new Error("transport name required");
  }
  if (!impl || typeof impl.send !== "function" || typeof impl.receive !== "function") {
    throw new Error("transport must implement send() and receive()");
  }
  transports[name] = impl;
}
