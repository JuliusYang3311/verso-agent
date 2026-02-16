import fs from "node:fs";
import path from "node:path";
import type { Mutation } from "./mutation.js";
import type { PersonalityState } from "./personality.js";
import { isValidMutation, normalizeMutation } from "./mutation.js";
import { getMemoryDir, getEvolutionDir } from "./paths.js";
import {
  normalizePersonalityState,
  isValidPersonalityState,
  personalityKey,
} from "./personality.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** A generic gene reference used across memory graph operations. */
export interface Gene {
  type: string;
  id: string;
  category?: string | null;
}

/** Signal information attached to memory graph events. */
export interface SignalInfo {
  key: string;
  signals: string[];
  error_signature?: string | null;
}

/** Outcome status for an evolution action. */
export interface OutcomeInfo {
  status: string;
  score: number;
  note: string;
  observed?: { current_signals: string[] };
}

/** Aggregated edge between a signal key and a gene. */
interface AggregatedEdge {
  signalKey: string;
  geneId: string;
  success: number;
  fail: number;
  last_ts: string | null;
  last_score: number | null;
}

/** Aggregated outcome statistics for a single gene. */
interface AggregatedGeneOutcome {
  geneId: string;
  success: number;
  fail: number;
  last_ts: string | null;
  last_score: number | null;
}

/** Result of edge expected-success computation. */
interface EdgeExpected {
  p: number;
  w: number;
  total: number;
  value: number;
}

/** Options for edge expected-success computation. */
interface EdgeExpectedOpts {
  half_life_days?: number;
}

/** Scored gene entry returned by getMemoryAdvice. */
interface ScoredGene {
  geneId: string;
  score: number;
  attempts: number;
  prior: number;
}

/** Result of getMemoryAdvice. */
export interface MemoryAdvice {
  currentSignalKey: string;
  preferredGeneId: string | null;
  bannedGeneIds: Set<string>;
  explanation: string[];
}

/** Parameters for getMemoryAdvice. */
export interface GetMemoryAdviceParams {
  signals?: unknown[];
  genes?: unknown[];
  driftEnabled?: boolean;
}

/** Parameters for recordSignalSnapshot. */
export interface RecordSignalSnapshotParams {
  signals?: unknown[];
  observations?: Record<string, unknown> | null;
}

/** Parameters for recordHypothesis. */
export interface RecordHypothesisParams {
  signals?: unknown[];
  mutation?: unknown;
  personality_state?: unknown;
  selectedGene?: { id?: string; category?: string } | null;
  selector?: string | null;
  driftEnabled?: boolean;
  selectedBy?: string | null;
  capsulesUsed?: unknown[];
  observations?: Record<string, unknown> | null;
}

/** Parameters for recordAttempt. */
export interface RecordAttemptParams {
  signals?: unknown[];
  mutation?: unknown;
  personality_state?: unknown;
  selectedGene?: { id?: string; category?: string } | null;
  selector?: string | null;
  driftEnabled?: boolean;
  selectedBy?: string | null;
  hypothesisId?: string | null;
  capsulesUsed?: unknown[];
  observations?: Record<string, unknown> | null;
}

/** Parameters for recordOutcomeFromState. */
export interface RecordOutcomeFromStateParams {
  signals?: unknown[];
  observations?: Record<string, unknown> | null;
}

/** Parameters for recordExternalCandidate. */
export interface RecordExternalCandidateParams {
  asset?: Record<string, unknown> | null;
  source?: string | null;
  signals?: unknown[];
}

/** Parameters for buildHypothesisText. */
interface BuildHypothesisTextParams {
  signalKey: string;
  signals?: unknown[];
  geneId: string | null;
  geneCategory: string | null;
  driftEnabled?: boolean;
}

/** Parameters for buildConfidenceEdgeEvent. */
interface BuildConfidenceEdgeEventParams {
  signalKey: string;
  signals?: unknown[];
  geneId: string;
  geneCategory: string | null;
  outcomeEventId: string | null;
  halfLifeDays: number;
}

/** Parameters for buildGeneOutcomeConfidenceEvent. */
interface BuildGeneOutcomeConfidenceEventParams {
  geneId: string;
  geneCategory: string | null;
  outcomeEventId: string | null;
  halfLifeDays: number;
}

/** Parameters for inferOutcomeFromSignals. */
interface InferOutcomeFromSignalsParams {
  prevHadError: boolean;
  currentHasError: boolean;
}

/** Parameters for inferOutcomeEnhanced. */
interface InferOutcomeEnhancedParams {
  prevHadError: boolean;
  currentHasError: boolean;
  baselineObserved: Record<string, unknown> | null;
  currentObserved: Record<string, unknown> | null;
}

/** Inferred outcome result. */
interface InferredOutcome {
  status: string;
  score: number;
  note: string;
}

/** A memory graph event (append-only JSONL record). */
export interface MemoryGraphEvent {
  type: "MemoryGraphEvent";
  kind: string;
  id: string;
  ts: string;
  signal?: SignalInfo | null;
  gene?: { id: string | null; category?: string | null } | null;
  outcome?: OutcomeInfo | null;
  [key: string]: unknown;
}

/** Last-action state persisted between cycles. */
interface LastActionState {
  action_id: string;
  signal_key: string;
  signals: string[];
  mutation_id: string | null;
  mutation_category: string | null;
  mutation_risk_level: string | null;
  personality_key: string | null;
  personality_state: PersonalityState | null;
  gene_id: string | null;
  gene_category: string | null;
  hypothesis_id: string | null;
  capsules_used: string[];
  had_error: boolean;
  created_at: string;
  outcome_recorded: boolean;
  outcome_recorded_at?: string;
  baseline_observed: Record<string, unknown> | null;
}

/** Memory graph mutable state file schema. */
interface MemoryGraphState {
  last_action: LastActionState | null;
}

/** Internal per-gene scoring bucket used in getMemoryAdvice. */
interface GeneScoreBucket {
  geneId: string;
  best: number;
  attempts: number;
  prior: number;
  prior_attempts: number;
}

/** Candidate signal key with similarity score. */
interface CandidateKey {
  key: string;
  sim: number;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (_e) {
    // Silently ignore directory creation errors.
  }
}

function stableHash(input: unknown): string {
  const s = String(input || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeErrorSignature(text: unknown): string | null {
  const s = String(text || "").trim();
  if (!s) {
    return null;
  }
  return (
    s
      .toLowerCase()
      // Normalize Windows paths
      .replace(/[a-z]:\\[^ \n\r\t]+/gi, "<path>")
      // Normalize Unix paths
      .replace(/\/[^ \n\r\t]+/g, "<path>")
      // Normalize hex and numbers
      .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
      .replace(/\b\d+\b/g, "<n>")
      // Normalize whitespace
      .replace(/\s+/g, " ")
      .slice(0, 220)
  );
}

function normalizeSignalsForMatching(signals: unknown[]): string[] {
  const list = Array.isArray(signals) ? signals : [];
  const out: string[] = [];
  for (const s of list) {
    const str = String(s || "").trim();
    if (!str) {
      continue;
    }
    if (str.startsWith("errsig:")) {
      const norm = normalizeErrorSignature(str.slice("errsig:".length));
      if (norm) {
        out.push(`errsig_norm:${stableHash(norm)}`);
      }
      continue;
    }
    out.push(str);
  }
  return out;
}

export function computeSignalKey(signals: unknown[]): string {
  // Key must be stable across runs; normalize noisy signatures (paths, numbers).
  const list = normalizeSignalsForMatching(signals);
  const uniq = Array.from(new Set(list.filter(Boolean))).toSorted();
  return uniq.join("|") || "(none)";
}

function extractErrorSignatureFromSignals(signals: unknown[]): string | null {
  // Convention: signals can include "errsig:<raw>" emitted by signals extractor.
  const list = Array.isArray(signals) ? signals : [];
  for (const s of list) {
    const str = String(s || "");
    if (str.startsWith("errsig:")) {
      return normalizeErrorSignature(str.slice("errsig:".length));
    }
  }
  return null;
}

export function memoryGraphPath(): string {
  const evoDir = getEvolutionDir();
  return process.env.MEMORY_GRAPH_PATH || path.join(evoDir, "memory_graph.jsonl");
}

function memoryGraphStatePath(): string {
  return path.join(getEvolutionDir(), "memory_graph_state.json");
}

function appendJsonl(filePath: string, obj: unknown): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  fs.appendFileSync(filePath, JSON.stringify(obj) + "\n", "utf8");
}

function readJsonIfExists<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch (_e) {
    return fallback;
  }
}

function writeJsonAtomic(filePath: string, obj: unknown): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

export function tryReadMemoryGraphEvents(limitLines: number = 2000): MemoryGraphEvent[] {
  try {
    const p = memoryGraphPath();
    if (!fs.existsSync(p)) {
      return [];
    }
    const raw = fs.readFileSync(p, "utf8");
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const recent = lines.slice(Math.max(0, lines.length - limitLines));
    return recent
      .map((l): MemoryGraphEvent | null => {
        try {
          return JSON.parse(l) as MemoryGraphEvent;
        } catch (_e) {
          return null;
        }
      })
      .filter((x): x is MemoryGraphEvent => x !== null);
  } catch (_e) {
    return [];
  }
}

function jaccard(aList: unknown[], bList: unknown[]): number {
  const aNorm = normalizeSignalsForMatching(aList);
  const bNorm = normalizeSignalsForMatching(bList);
  const a = new Set((Array.isArray(aNorm) ? aNorm : []).map(String));
  const b = new Set((Array.isArray(bNorm) ? bNorm : []).map(String));
  if (a.size === 0 && b.size === 0) {
    return 1;
  }
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function decayWeight(updatedAtIso: string, halfLifeDays: number): number {
  const hl = Number(halfLifeDays);
  if (!Number.isFinite(hl) || hl <= 0) {
    return 1;
  }
  const t = Date.parse(updatedAtIso);
  if (!Number.isFinite(t)) {
    return 1;
  }
  const ageDays = (Date.now() - t) / (1000 * 60 * 60 * 24);
  if (!Number.isFinite(ageDays) || ageDays <= 0) {
    return 1;
  }
  // Exponential half-life decay: weight = 0.5^(age/hl)
  return Math.pow(0.5, ageDays / hl);
}

function aggregateEdges(events: MemoryGraphEvent[]): Map<string, AggregatedEdge> {
  // Aggregate by (signal_key, gene_id) from outcome events.
  // Laplace smoothing to avoid 0/1 extremes.
  const map = new Map<string, AggregatedEdge>();
  for (const ev of events) {
    if (!ev || ev.type !== "MemoryGraphEvent") {
      continue;
    }
    if (ev.kind !== "outcome") {
      continue;
    }
    const signalKey = ev.signal && ev.signal.key ? String(ev.signal.key) : "(none)";
    const geneId = ev.gene && ev.gene.id ? String(ev.gene.id) : null;
    if (!geneId) {
      continue;
    }

    const k = `${signalKey}::${geneId}`;
    const cur = map.get(k) || {
      signalKey,
      geneId,
      success: 0,
      fail: 0,
      last_ts: null,
      last_score: null,
    };
    const status = ev.outcome && ev.outcome.status ? String(ev.outcome.status) : "unknown";
    if (status === "success") {
      cur.success += 1;
    } else if (status === "failed") {
      cur.fail += 1;
    }

    const ts = (ev.ts ||
      (ev as Record<string, unknown>).created_at ||
      (ev as Record<string, unknown>).at) as string | undefined;
    if (ts && (!cur.last_ts || Date.parse(ts) > Date.parse(cur.last_ts))) {
      cur.last_ts = ts;
      cur.last_score =
        ev.outcome && Number.isFinite(Number(ev.outcome.score))
          ? Number(ev.outcome.score)
          : cur.last_score;
    }
    map.set(k, cur);
  }
  return map;
}

function aggregateGeneOutcomes(events: MemoryGraphEvent[]): Map<string, AggregatedGeneOutcome> {
  // Aggregate by gene_id from outcome events (gene -> outcome success probability).
  const map = new Map<string, AggregatedGeneOutcome>();
  for (const ev of events) {
    if (!ev || ev.type !== "MemoryGraphEvent") {
      continue;
    }
    if (ev.kind !== "outcome") {
      continue;
    }
    const geneId = ev.gene && ev.gene.id ? String(ev.gene.id) : null;
    if (!geneId) {
      continue;
    }
    const cur = map.get(geneId) || { geneId, success: 0, fail: 0, last_ts: null, last_score: null };
    const status = ev.outcome && ev.outcome.status ? String(ev.outcome.status) : "unknown";
    if (status === "success") {
      cur.success += 1;
    } else if (status === "failed") {
      cur.fail += 1;
    }
    const ts = (ev.ts ||
      (ev as Record<string, unknown>).created_at ||
      (ev as Record<string, unknown>).at) as string | undefined;
    if (ts && (!cur.last_ts || Date.parse(ts) > Date.parse(cur.last_ts))) {
      cur.last_ts = ts;
      cur.last_score =
        ev.outcome && Number.isFinite(Number(ev.outcome.score))
          ? Number(ev.outcome.score)
          : cur.last_score;
    }
    map.set(geneId, cur);
  }
  return map;
}

function edgeExpectedSuccess(
  edge: AggregatedEdge | AggregatedGeneOutcome | null,
  opts?: EdgeExpectedOpts,
): EdgeExpected {
  const e = edge || { success: 0, fail: 0, last_ts: null };
  const succ = Number(e.success) || 0;
  const fail = Number(e.fail) || 0;
  const total = succ + fail;
  const p = (succ + 1) / (total + 2); // Laplace smoothing
  const halfLifeDays =
    opts && Number.isFinite(Number(opts.half_life_days)) ? Number(opts.half_life_days) : 30;
  const w = decayWeight(e.last_ts || "", halfLifeDays);
  return { p, w, total, value: p * w };
}

export function getMemoryAdvice({
  signals,
  genes,
  driftEnabled,
}: GetMemoryAdviceParams): MemoryAdvice {
  const events = tryReadMemoryGraphEvents(2000);
  const edges = aggregateEdges(events);
  const geneOutcomes = aggregateGeneOutcomes(events);
  const curSignals: unknown[] = Array.isArray(signals) ? signals : [];
  const curKey = computeSignalKey(curSignals);

  const bannedGeneIds = new Set<string>();
  const scoredGeneIds: ScoredGene[] = [];

  // Similarity: consider exact key first, then any key with overlap.
  const seenKeys = new Set<string>();
  const candidateKeys: CandidateKey[] = [];
  candidateKeys.push({ key: curKey, sim: 1 });
  seenKeys.add(curKey);

  for (const ev of events) {
    if (!ev || ev.type !== "MemoryGraphEvent") {
      continue;
    }
    const k = ev.signal && ev.signal.key ? String(ev.signal.key) : "(none)";
    if (seenKeys.has(k)) {
      continue;
    }
    const sigs = ev.signal && Array.isArray(ev.signal.signals) ? ev.signal.signals : [];
    const sim = jaccard(curSignals, sigs);
    if (sim >= 0.34) {
      candidateKeys.push({ key: k, sim });
      seenKeys.add(k);
    }
  }

  const byGene = new Map<string, GeneScoreBucket>();
  for (const ck of candidateKeys) {
    for (const g of (Array.isArray(genes) ? genes : []) as Record<string, unknown>[]) {
      if (!g || g.type !== "Gene" || !g.id) {
        continue;
      }
      const gId = String(g.id);
      const k = `${ck.key}::${gId}`;
      const edge = edges.get(k);
      const cur = byGene.get(gId) || {
        geneId: gId,
        best: 0,
        attempts: 0,
        prior: 0,
        prior_attempts: 0,
      };

      // Signal->Gene edge score (if available)
      if (edge) {
        const ex = edgeExpectedSuccess(edge, { half_life_days: 30 });
        const weighted = ex.value * ck.sim;
        if (weighted > cur.best) {
          cur.best = weighted;
        }
        cur.attempts = Math.max(cur.attempts, ex.total);
      }

      // Gene->Outcome prior (independent of signal): stabilizer when signal edges are sparse.
      const gEdge = geneOutcomes.get(gId);
      if (gEdge) {
        const gx = edgeExpectedSuccess(gEdge, { half_life_days: 45 });
        cur.prior = Math.max(cur.prior, gx.value);
        cur.prior_attempts = Math.max(cur.prior_attempts, gx.total);
      }

      byGene.set(gId, cur);
    }
  }

  for (const [geneId, info] of byGene.entries()) {
    const combined = info.best > 0 ? info.best + info.prior * 0.12 : info.prior * 0.4;
    scoredGeneIds.push({ geneId, score: combined, attempts: info.attempts, prior: info.prior });
    // Low-efficiency path suppression (unless drift is explicit).
    if (!driftEnabled && info.attempts >= 2 && info.best < 0.18) {
      bannedGeneIds.add(geneId);
    }
    // Also suppress genes with consistently poor global outcomes when signal edges are sparse.
    if (!driftEnabled && info.attempts < 2 && info.prior_attempts >= 3 && info.prior < 0.12) {
      bannedGeneIds.add(geneId);
    }
  }

  scoredGeneIds.sort((a, b) => b.score - a.score);
  const preferredGeneId = scoredGeneIds.length ? scoredGeneIds[0].geneId : null;

  const explanation: string[] = [];
  if (preferredGeneId) {
    explanation.push(`memory_prefer:${preferredGeneId}`);
  }
  if (bannedGeneIds.size) {
    explanation.push(`memory_ban:${Array.from(bannedGeneIds).slice(0, 6).join(",")}`);
  }
  if (preferredGeneId) {
    const top = scoredGeneIds.find((x) => x && x.geneId === preferredGeneId);
    if (top && Number.isFinite(Number(top.prior)) && top.prior > 0) {
      explanation.push(`gene_prior:${top.prior.toFixed(3)}`);
    }
  }
  if (driftEnabled) {
    explanation.push("random_drift:enabled");
  }

  return {
    currentSignalKey: curKey,
    preferredGeneId,
    bannedGeneIds,
    explanation,
  };
}

export function recordSignalSnapshot({
  signals,
  observations,
}: RecordSignalSnapshotParams): MemoryGraphEvent {
  const signalList: unknown[] = Array.isArray(signals) ? signals : [];
  const signalKey = computeSignalKey(signalList);
  const ts = nowIso();
  const errsig = extractErrorSignatureFromSignals(signalList);
  const ev: MemoryGraphEvent = {
    type: "MemoryGraphEvent",
    kind: "signal",
    id: `mge_${Date.now()}_${stableHash(`${signalKey}|signal|${ts}`)}`,
    ts,
    signal: {
      key: signalKey,
      signals: signalList.map((s) => String(s || "")),
      error_signature: errsig || null,
    },
    observed: observations && typeof observations === "object" ? observations : null,
  };
  appendJsonl(memoryGraphPath(), ev);
  return ev;
}

function buildHypothesisText({
  signalKey,
  signals,
  geneId,
  geneCategory,
  driftEnabled,
}: BuildHypothesisTextParams): string {
  const sigCount = Array.isArray(signals) ? signals.length : 0;
  const drift = driftEnabled ? "drift" : "directed";
  const g = geneId ? `${geneId}${geneCategory ? `(${geneCategory})` : ""}` : "(none)";
  return `Given signal_key=${signalKey} with ${sigCount} signals, selecting gene=${g} under mode=${drift} is expected to reduce repeated errors and improve stability.`;
}

export function recordHypothesis({
  signals,
  mutation,
  personality_state,
  selectedGene,
  selector,
  driftEnabled,
  selectedBy,
  capsulesUsed,
  observations,
}: RecordHypothesisParams): { hypothesisId: string; signalKey: string } {
  const signalList: unknown[] = Array.isArray(signals) ? signals : [];
  const signalKey = computeSignalKey(signalList);
  const geneId = selectedGene && selectedGene.id ? String(selectedGene.id) : null;
  const geneCategory = selectedGene && selectedGene.category ? String(selectedGene.category) : null;
  const ts = nowIso();
  const errsig = extractErrorSignatureFromSignals(signalList);
  const hypothesisId = `hyp_${Date.now()}_${stableHash(`${signalKey}|${geneId || "none"}|${ts}`)}`;
  const personalityState = personality_state || null;
  const mutNorm = mutation && isValidMutation(mutation) ? normalizeMutation(mutation) : null;
  const psNorm =
    personalityState && isValidPersonalityState(personalityState)
      ? normalizePersonalityState(personalityState)
      : null;
  const ev: MemoryGraphEvent = {
    type: "MemoryGraphEvent",
    kind: "hypothesis",
    id: `mge_${Date.now()}_${stableHash(`${hypothesisId}|${ts}`)}`,
    ts,
    signal: {
      key: signalKey,
      signals: signalList.map((s) => String(s || "")),
      error_signature: errsig || null,
    },
    hypothesis: {
      id: hypothesisId,
      text: buildHypothesisText({
        signalKey,
        signals: signalList,
        geneId,
        geneCategory,
        driftEnabled,
      }),
      predicted_outcome: { status: null, score: null },
    },
    mutation: mutNorm
      ? {
          id: mutNorm.id,
          category: mutNorm.category,
          trigger_signals: mutNorm.trigger_signals,
          target: mutNorm.target,
          expected_effect: mutNorm.expected_effect,
          risk_level: mutNorm.risk_level,
        }
      : null,
    personality: psNorm
      ? {
          key: personalityKey(psNorm),
          state: psNorm,
        }
      : null,
    gene: { id: geneId, category: geneCategory },
    action: {
      drift: !!driftEnabled,
      selected_by: selectedBy || "selector",
      selector: selector || null,
    },
    capsules: {
      used: Array.isArray(capsulesUsed) ? capsulesUsed.map(String).filter(Boolean) : [],
    },
    observed: observations && typeof observations === "object" ? observations : null,
  };
  appendJsonl(memoryGraphPath(), ev);
  return { hypothesisId, signalKey };
}

function hasErrorSignal(signals: unknown[]): boolean {
  const list = Array.isArray(signals) ? signals : [];
  return list.includes("log_error");
}

export function recordAttempt({
  signals,
  mutation,
  personality_state,
  selectedGene,
  selector,
  driftEnabled,
  selectedBy,
  hypothesisId,
  capsulesUsed,
  observations,
}: RecordAttemptParams): { actionId: string; signalKey: string } {
  const signalList: unknown[] = Array.isArray(signals) ? signals : [];
  const signalKey = computeSignalKey(signalList);
  const geneId = selectedGene && selectedGene.id ? String(selectedGene.id) : null;
  const geneCategory = selectedGene && selectedGene.category ? String(selectedGene.category) : null;
  const ts = nowIso();
  const errsig = extractErrorSignatureFromSignals(signalList);
  const actionId = `act_${Date.now()}_${stableHash(`${signalKey}|${geneId || "none"}|${ts}`)}`;
  const personalityState = personality_state || null;
  const mutNorm = mutation && isValidMutation(mutation) ? normalizeMutation(mutation) : null;
  const psNorm =
    personalityState && isValidPersonalityState(personalityState)
      ? normalizePersonalityState(personalityState)
      : null;
  const ev: MemoryGraphEvent = {
    type: "MemoryGraphEvent",
    kind: "attempt",
    id: `mge_${Date.now()}_${stableHash(actionId)}`,
    ts,
    signal: {
      key: signalKey,
      signals: signalList.map((s) => String(s || "")),
      error_signature: errsig || null,
    },
    mutation: mutNorm
      ? {
          id: mutNorm.id,
          category: mutNorm.category,
          trigger_signals: mutNorm.trigger_signals,
          target: mutNorm.target,
          expected_effect: mutNorm.expected_effect,
          risk_level: mutNorm.risk_level,
        }
      : null,
    personality: psNorm
      ? {
          key: personalityKey(psNorm),
          state: psNorm,
        }
      : null,
    gene: { id: geneId, category: geneCategory },
    hypothesis: hypothesisId ? { id: String(hypothesisId) } : null,
    action: {
      id: actionId,
      drift: !!driftEnabled,
      selected_by: selectedBy || "selector",
      selector: selector || null,
    },
    capsules: {
      used: Array.isArray(capsulesUsed) ? capsulesUsed.map(String).filter(Boolean) : [],
    },
    observed: observations && typeof observations === "object" ? observations : null,
  };

  appendJsonl(memoryGraphPath(), ev);

  // State is mutable; graph is append-only.
  const statePath = memoryGraphStatePath();
  const state = readJsonIfExists<MemoryGraphState>(statePath, { last_action: null });
  state.last_action = {
    action_id: actionId,
    signal_key: signalKey,
    signals: signalList.map((s) => String(s || "")),
    mutation_id: mutNorm ? mutNorm.id : null,
    mutation_category: mutNorm ? mutNorm.category : null,
    mutation_risk_level: mutNorm ? mutNorm.risk_level : null,
    personality_key: psNorm ? personalityKey(psNorm) : null,
    personality_state: psNorm || null,
    gene_id: geneId,
    gene_category: geneCategory,
    hypothesis_id: hypothesisId ? String(hypothesisId) : null,
    capsules_used: Array.isArray(capsulesUsed) ? capsulesUsed.map(String).filter(Boolean) : [],
    had_error: hasErrorSignal(signalList),
    created_at: ts,
    outcome_recorded: false,
    baseline_observed: observations && typeof observations === "object" ? observations : null,
  };
  writeJsonAtomic(statePath, state);

  return { actionId, signalKey };
}

function inferOutcomeFromSignals({
  prevHadError,
  currentHasError,
}: InferOutcomeFromSignalsParams): InferredOutcome {
  if (prevHadError && !currentHasError) {
    return { status: "success", score: 0.85, note: "error_cleared" };
  }
  if (prevHadError && currentHasError) {
    return { status: "failed", score: 0.2, note: "error_persisted" };
  }
  if (!prevHadError && currentHasError) {
    return { status: "failed", score: 0.15, note: "new_error_appeared" };
  }
  return { status: "success", score: 0.6, note: "stable_no_error" };
}

function clamp01(x: unknown): number {
  const n = Number(x);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(1, n));
}

function tryParseLastEvolutionEventOutcome(evidenceText: string): InferredOutcome | null {
  // Scan tail text for an EvolutionEvent JSON line and extract its outcome.
  const s = String(evidenceText || "");
  if (!s) {
    return null;
  }
  const lines = s.split("\n").slice(-400);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    if (!line.includes('"type"') || !line.includes("EvolutionEvent")) {
      continue;
    }
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (!obj || obj.type !== "EvolutionEvent") {
        continue;
      }
      const o =
        obj.outcome && typeof obj.outcome === "object"
          ? (obj.outcome as Record<string, unknown>)
          : null;
      if (!o) {
        continue;
      }
      const status = o.status === "success" || o.status === "failed" ? (o.status as string) : null;
      const score = Number.isFinite(Number(o.score)) ? clamp01(Number(o.score)) : null;
      if (!status && score == null) {
        continue;
      }
      return {
        status: status || (score != null && score >= 0.5 ? "success" : "failed"),
        score: score != null ? score : status === "success" ? 0.75 : 0.25,
        note: "evolutionevent_observed",
      };
    } catch (_e) {
      continue;
    }
  }
  return null;
}

function inferOutcomeEnhanced({
  prevHadError,
  currentHasError,
  baselineObserved,
  currentObserved,
}: InferOutcomeEnhancedParams): InferredOutcome {
  const evidence =
    currentObserved &&
    (currentObserved as Record<string, unknown>).evidence &&
    (((currentObserved as Record<string, unknown>).evidence as Record<string, unknown>)
      .recent_session_tail ||
      ((currentObserved as Record<string, unknown>).evidence as Record<string, unknown>)
        .today_log_tail)
      ? ((currentObserved as Record<string, unknown>).evidence as Record<string, unknown>)
      : null;
  const combinedEvidence = evidence
    ? `${String(evidence.recent_session_tail || "")}\n${String(evidence.today_log_tail || "")}`
    : "";
  const observed = tryParseLastEvolutionEventOutcome(combinedEvidence);
  if (observed) {
    return observed;
  }

  const base = inferOutcomeFromSignals({ prevHadError, currentHasError });

  const prevErrCount =
    baselineObserved && Number.isFinite(Number(baselineObserved.recent_error_count))
      ? Number(baselineObserved.recent_error_count)
      : null;
  const curErrCount =
    currentObserved && Number.isFinite(Number(currentObserved.recent_error_count))
      ? Number(currentObserved.recent_error_count)
      : null;

  let score = base.score;
  if (prevErrCount != null && curErrCount != null) {
    const delta = prevErrCount - curErrCount;
    score += Math.max(-0.12, Math.min(0.12, delta / 50));
  }

  const prevScan =
    baselineObserved && Number.isFinite(Number(baselineObserved.scan_ms))
      ? Number(baselineObserved.scan_ms)
      : null;
  const curScan =
    currentObserved && Number.isFinite(Number(currentObserved.scan_ms))
      ? Number(currentObserved.scan_ms)
      : null;
  if (prevScan != null && curScan != null && prevScan > 0) {
    const ratio = (prevScan - curScan) / prevScan;
    score += Math.max(-0.06, Math.min(0.06, ratio));
  }

  return { status: base.status, score: clamp01(score), note: `${base.note}|heuristic_delta` };
}

function buildConfidenceEdgeEvent({
  signalKey,
  signals,
  geneId,
  geneCategory,
  outcomeEventId,
  halfLifeDays,
}: BuildConfidenceEdgeEventParams): MemoryGraphEvent {
  const events = tryReadMemoryGraphEvents(2000);
  const edges = aggregateEdges(events);
  const k = `${signalKey}::${geneId}`;
  const edge = edges.get(k) || {
    signalKey,
    geneId,
    success: 0,
    fail: 0,
    last_ts: null,
    last_score: null,
  };
  const ex = edgeExpectedSuccess(edge, { half_life_days: halfLifeDays });
  const ts = nowIso();
  return {
    type: "MemoryGraphEvent",
    kind: "confidence_edge",
    id: `mge_${Date.now()}_${stableHash(`${signalKey}|${geneId}|confidence|${ts}`)}`,
    ts,
    signal: {
      key: signalKey,
      signals: Array.isArray(signals) ? signals.map((s) => String(s || "")) : [],
    },
    gene: { id: geneId, category: geneCategory || null },
    edge: { signal_key: signalKey, gene_id: geneId },
    stats: {
      success: Number(edge.success) || 0,
      fail: Number(edge.fail) || 0,
      attempts: Number(ex.total) || 0,
      p: ex.p,
      decay_weight: ex.w,
      value: ex.value,
      half_life_days: halfLifeDays,
      updated_at: ts,
    },
    derived_from: { outcome_event_id: outcomeEventId || null },
  };
}

function buildGeneOutcomeConfidenceEvent({
  geneId,
  geneCategory,
  outcomeEventId,
  halfLifeDays,
}: BuildGeneOutcomeConfidenceEventParams): MemoryGraphEvent {
  const events = tryReadMemoryGraphEvents(2000);
  const geneOutcomes = aggregateGeneOutcomes(events);
  const edge = geneOutcomes.get(String(geneId)) || {
    geneId: String(geneId),
    success: 0,
    fail: 0,
    last_ts: null,
    last_score: null,
  };
  const ex = edgeExpectedSuccess(edge, { half_life_days: halfLifeDays });
  const ts = nowIso();
  return {
    type: "MemoryGraphEvent",
    kind: "confidence_gene_outcome",
    id: `mge_${Date.now()}_${stableHash(`${geneId}|gene_outcome|confidence|${ts}`)}`,
    ts,
    gene: { id: String(geneId), category: geneCategory || null },
    edge: { gene_id: String(geneId) },
    stats: {
      success: Number(edge.success) || 0,
      fail: Number(edge.fail) || 0,
      attempts: Number(ex.total) || 0,
      p: ex.p,
      decay_weight: ex.w,
      value: ex.value,
      half_life_days: halfLifeDays,
      updated_at: ts,
    },
    derived_from: { outcome_event_id: outcomeEventId || null },
  };
}

export function recordOutcomeFromState({
  signals,
  observations,
}: RecordOutcomeFromStateParams): MemoryGraphEvent | null {
  const statePath = memoryGraphStatePath();
  const state = readJsonIfExists<MemoryGraphState>(statePath, { last_action: null });
  const last = state && state.last_action ? state.last_action : null;
  if (!last || !last.action_id) {
    return null;
  }
  if (last.outcome_recorded) {
    return null;
  }

  const signalList: unknown[] = Array.isArray(signals) ? signals : [];
  const currentHasError = hasErrorSignal(signalList);
  const inferred = inferOutcomeEnhanced({
    prevHadError: !!last.had_error,
    currentHasError,
    baselineObserved: last.baseline_observed || null,
    currentObserved: (observations as Record<string, unknown>) || null,
  });
  const ts = nowIso();
  const errsig = extractErrorSignatureFromSignals(signalList);
  const ev: MemoryGraphEvent = {
    type: "MemoryGraphEvent",
    kind: "outcome",
    id: `mge_${Date.now()}_${stableHash(`${last.action_id}|outcome|${ts}`)}`,
    ts,
    signal: {
      key: String(last.signal_key || "(none)"),
      signals: Array.isArray(last.signals) ? last.signals : [],
      error_signature: errsig || null,
    },
    mutation:
      last.mutation_id || last.mutation_category || last.mutation_risk_level
        ? {
            id: last.mutation_id || null,
            category: last.mutation_category || null,
            risk_level: last.mutation_risk_level || null,
          }
        : null,
    personality:
      last.personality_key || last.personality_state
        ? {
            key: last.personality_key || null,
            state: last.personality_state || null,
          }
        : null,
    gene: { id: last.gene_id || null, category: last.gene_category || null },
    action: { id: String(last.action_id) },
    hypothesis: last.hypothesis_id ? { id: String(last.hypothesis_id) } : null,
    outcome: {
      status: inferred.status,
      score: inferred.score,
      note: inferred.note,
      observed: { current_signals: signalList.map((s) => String(s || "")) },
    },
    confidence: {
      // Interpretable, decayed success estimate derived from outcomes; aggregation is computed at read-time.
      half_life_days: 30,
    },
    observed: observations && typeof observations === "object" ? observations : null,
    baseline: last.baseline_observed || null,
    capsules: {
      used: Array.isArray(last.capsules_used) ? last.capsules_used : [],
    },
  };

  appendJsonl(memoryGraphPath(), ev);

  // Persist explicit confidence snapshots (append-only) for auditability.
  try {
    if (last.gene_id) {
      const edgeEv = buildConfidenceEdgeEvent({
        signalKey: String(last.signal_key || "(none)"),
        signals: Array.isArray(last.signals) ? last.signals : [],
        geneId: String(last.gene_id),
        geneCategory: last.gene_category || null,
        outcomeEventId: ev.id,
        halfLifeDays: 30,
      });
      appendJsonl(memoryGraphPath(), edgeEv);

      const geneEv = buildGeneOutcomeConfidenceEvent({
        geneId: String(last.gene_id),
        geneCategory: last.gene_category || null,
        outcomeEventId: ev.id,
        halfLifeDays: 45,
      });
      appendJsonl(memoryGraphPath(), geneEv);
    }
  } catch (_e) {
    // Silently ignore confidence snapshot errors.
  }

  last.outcome_recorded = true;
  last.outcome_recorded_at = ts;
  state.last_action = last;
  writeJsonAtomic(statePath, state);

  return ev;
}

export function recordExternalCandidate({
  asset,
  source,
  signals,
}: RecordExternalCandidateParams): MemoryGraphEvent | null {
  // Append-only annotation: external assets enter as candidates only.
  // This does not affect outcome aggregation (which only uses kind === 'outcome').
  const a = asset && typeof asset === "object" ? asset : null;
  if (!a) {
    return null;
  }
  const assetType = a.type ? String(a.type) : null;
  const assetId = a.id ? String(a.id) : null;
  if (!assetType || !assetId) {
    return null;
  }

  const ts = nowIso();
  const signalList: unknown[] = Array.isArray(signals) ? signals : [];
  const signalKey = computeSignalKey(signalList);
  const ev: MemoryGraphEvent = {
    type: "MemoryGraphEvent",
    kind: "external_candidate",
    id: `mge_${Date.now()}_${stableHash(`${assetType}|${assetId}|external|${ts}`)}`,
    ts,
    signal: { key: signalKey, signals: signalList.map((s) => String(s || "")) },
    external: {
      source: source || "external",
      received_at: ts,
    },
    asset: { type: assetType, id: assetId },
    candidate: {
      // Minimal hints for later local triggering/validation.
      trigger: assetType === "Capsule" && Array.isArray(a.trigger) ? (a.trigger as unknown[]) : [],
      gene: assetType === "Capsule" && a.gene ? String(a.gene) : null,
      confidence:
        assetType === "Capsule" && Number.isFinite(Number(a.confidence))
          ? Number(a.confidence)
          : null,
    },
  };

  appendJsonl(memoryGraphPath(), ev);
  return ev;
}
