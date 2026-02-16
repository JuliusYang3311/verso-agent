import fs from "node:fs";
import { unwrapAssetFromMessage } from "./a2aProtocol.js";
import { readAllEvents } from "./assetStore.js";
import { computeAssetId, SCHEMA_VERSION } from "./contentHash.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function isAllowedA2AAsset(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  const t = (obj as Record<string, unknown>).type;
  return t === "Gene" || t === "Capsule" || t === "EvolutionEvent";
}

function safeNumber(x: unknown, fallback: number | null = null): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

interface BlastRadiusLimits {
  maxFiles: number;
  maxLines: number;
}

function getBlastRadiusLimits(): BlastRadiusLimits {
  const maxFiles = safeNumber(process.env.A2A_MAX_FILES, 5);
  const maxLines = safeNumber(process.env.A2A_MAX_LINES, 200);
  return {
    maxFiles: Number.isFinite(maxFiles) ? (maxFiles as number) : 5,
    maxLines: Number.isFinite(maxLines) ? (maxLines as number) : 200,
  };
}

interface BlastRadius {
  files?: unknown;
  lines?: unknown;
}

export function isBlastRadiusSafe(blastRadius: BlastRadius | null | undefined): boolean {
  const lim = getBlastRadiusLimits();
  const files =
    blastRadius && Number.isFinite(Number(blastRadius.files)) ? Number(blastRadius.files) : 0;
  const lines =
    blastRadius && Number.isFinite(Number(blastRadius.lines)) ? Number(blastRadius.lines) : 0;
  return files <= lim.maxFiles && lines <= lim.maxLines;
}

function clamp01(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) {
    return 0;
  }
  return Math.max(0, Math.min(1, x));
}

interface LowerConfidenceOpts {
  factor?: number;
  source?: string;
  received_at?: string;
}

export function lowerConfidence(
  asset: Record<string, unknown> | null | undefined,
  opts?: LowerConfidenceOpts,
): Record<string, unknown> | null {
  const o = opts || {};
  const factor = Number.isFinite(Number(o.factor)) ? Number(o.factor) : 0.6;
  const receivedFrom = o.source || "external";
  const receivedAt = o.received_at || nowIso();
  const cloned = JSON.parse(JSON.stringify(asset || {})) as Record<string, unknown>;
  if (!isAllowedA2AAsset(cloned)) {
    return null;
  }
  if (cloned.type === "Capsule") {
    if (typeof cloned.confidence === "number") {
      cloned.confidence = clamp01(cloned.confidence * factor);
    } else if (cloned.confidence != null) {
      cloned.confidence = clamp01(Number(cloned.confidence) * factor);
    }
  }
  if (!cloned.a2a || typeof cloned.a2a !== "object") {
    cloned.a2a = {};
  }
  const a2a = cloned.a2a as Record<string, unknown>;
  a2a.status = "external_candidate";
  a2a.source = receivedFrom;
  a2a.received_at = receivedAt;
  a2a.confidence_factor = factor;
  if (!cloned.schema_version) {
    cloned.schema_version = SCHEMA_VERSION;
  }
  if (!cloned.asset_id) {
    try {
      cloned.asset_id = computeAssetId(cloned);
    } catch {
      // ignore
    }
  }
  return cloned;
}

function readEvolutionEvents(): Record<string, unknown>[] {
  const events = readAllEvents();
  return Array.isArray(events) ? events.filter((e) => e && e.type === "EvolutionEvent") : [];
}

function normalizeEventsList(events: unknown): Record<string, unknown>[] {
  return Array.isArray(events) ? events : [];
}

interface ComputeStreakParams {
  capsuleId?: string;
  events?: Record<string, unknown>[];
}

export function computeCapsuleSuccessStreak(params: ComputeStreakParams): number {
  const id = params.capsuleId ? String(params.capsuleId) : "";
  if (!id) {
    return 0;
  }
  const list = normalizeEventsList(params.events || readEvolutionEvents());
  let streak = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const ev = list[i];
    if (!ev || ev.type !== "EvolutionEvent") {
      continue;
    }
    if (!ev.capsule_id || String(ev.capsule_id) !== id) {
      continue;
    }
    const st =
      ev.outcome && (ev.outcome as Record<string, unknown>).status
        ? String((ev.outcome as Record<string, unknown>).status)
        : "unknown";
    if (st === "success") {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

interface CapsuleAsset {
  type: string;
  id?: string;
  confidence?: unknown;
  outcome?: { score?: unknown; blast_radius?: BlastRadius };
  blast_radius?: BlastRadius;
  schema_version?: string;
  asset_id?: string;
  [key: string]: unknown;
}

interface BroadcastEligibleOpts {
  events?: Record<string, unknown>[];
}

export function isCapsuleBroadcastEligible(
  capsule: CapsuleAsset | null | undefined,
  opts?: BroadcastEligibleOpts,
): boolean {
  const o = opts || {};
  if (!capsule || capsule.type !== "Capsule") {
    return false;
  }
  const score =
    capsule.outcome && capsule.outcome.score != null
      ? safeNumber(capsule.outcome.score, null)
      : null;
  if (score == null || score < 0.7) {
    return false;
  }
  const blast = capsule.blast_radius || (capsule.outcome && capsule.outcome.blast_radius) || null;
  if (!isBlastRadiusSafe(blast)) {
    return false;
  }
  const events = Array.isArray(o.events) ? o.events : readEvolutionEvents();
  const streak = computeCapsuleSuccessStreak({ capsuleId: capsule.id, events });
  if (streak < 2) {
    return false;
  }
  return true;
}

interface ExportEligibleParams {
  capsules?: CapsuleAsset[];
  events?: Record<string, unknown>[];
}

export function exportEligibleCapsules(params?: ExportEligibleParams): CapsuleAsset[] {
  const p = params || {};
  const list = Array.isArray(p.capsules) ? p.capsules : [];
  const evs = Array.isArray(p.events) ? p.events : readEvolutionEvents();
  const eligible = list.filter((c) => isCapsuleBroadcastEligible(c, { events: evs }));
  for (let i = 0; i < eligible.length; i++) {
    const c = eligible[i];
    if (!c.schema_version) {
      c.schema_version = SCHEMA_VERSION;
    }
    if (!c.asset_id) {
      try {
        c.asset_id = computeAssetId(c as unknown as Record<string, unknown>) ?? undefined;
      } catch {
        // ignore
      }
    }
  }
  return eligible;
}

export function parseA2AInput(text: string | null | undefined): Record<string, unknown>[] {
  const raw = String(text || "").trim();
  if (!raw) {
    return [];
  }
  try {
    const maybe = JSON.parse(raw) as unknown;
    if (Array.isArray(maybe)) {
      return maybe
        .map((item: unknown) => unwrapAssetFromMessage(item) || item)
        .filter(Boolean) as Record<string, unknown>[];
    }
    if (maybe && typeof maybe === "object") {
      const unwrapped = unwrapAssetFromMessage(maybe);
      return unwrapped ? [unwrapped] : [maybe as Record<string, unknown>];
    }
  } catch {
    // fall through to line-by-line parsing
  }
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const obj = JSON.parse(lines[i]) as unknown;
      const uw = unwrapAssetFromMessage(obj);
      items.push((uw || obj) as Record<string, unknown>);
    } catch {
      continue;
    }
  }
  return items;
}

export function readTextIfExists(filePath: string | null | undefined): string {
  try {
    if (!filePath) {
      return "";
    }
    if (!fs.existsSync(filePath)) {
      return "";
    }
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}
