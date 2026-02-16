import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { EnvFingerprint } from "./envFingerprint.js";
import type { Mutation } from "./mutation.js";
import type { PersonalityState } from "./personality.js";
import type { ValidationReport } from "./validationReport.js";
import { computeCapsuleSuccessStreak, isBlastRadiusSafe } from "./a2a.js";
import {
  loadGenes,
  upsertGene,
  appendEventJsonl,
  upsertCapsule,
  getLastEventId,
  loadCapsules,
} from "./assetStore.js";
import { computeAssetId, SCHEMA_VERSION } from "./contentHash.js";
import { captureEnvFingerprint } from "./envFingerprint.js";
import { computeSignalKey, memoryGraphPath } from "./memoryGraph.js";
import {
  isValidMutation,
  normalizeMutation,
  isHighRiskMutationAllowed,
  isHighRiskPersonality,
} from "./mutation.js";
import { getRepoRoot, getMemoryDir, getEvolutionDir } from "./paths.js";
import {
  isValidPersonalityState,
  normalizePersonalityState,
  personalityKey,
  updatePersonalityStats,
} from "./personality.js";
import { runInSandbox } from "./sandbox-runner.js";
import { selectGene } from "./selector.js";
import { extractSignals } from "./signals.js";
import {
  validateSrcChanges,
  recordError,
  type BlastRadius as SrcBlastRadius,
} from "./src-optimizer.js";
import { buildValidationReport } from "./validationReport.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunCmdOpts {
  cwd?: string;
  timeoutMs?: number;
}

export interface CmdResult {
  ok: boolean;
  out: string;
  err: string;
}

export interface NumstatResult {
  added: number;
  deleted: number;
}

export interface BlastRadius {
  files: number;
  lines: number;
  changed_files: string[];
}

export interface ConstraintCheckResult {
  ok: boolean;
  violations: string[];
}

export interface GeneEntry {
  type: string;
  schema_version?: string;
  id: string;
  category?: string;
  signals_match?: string[];
  preconditions?: string[];
  strategy?: string[];
  constraints?: Record<string, unknown>;
  validation?: string[];
  asset_id?: string | null;
  [key: string]: unknown;
}

export interface SolidifyState {
  last_run?: SolidifyLastRun | null;
  last_solidify?: SolidifyLastSolidify | null;
  [key: string]: unknown;
}

export interface SolidifyLastRun {
  selected_gene_id?: string;
  parent_event_id?: string;
  signals?: string[];
  mutation?: Record<string, unknown> | null;
  personality_state?: Record<string, unknown> | null;
  personality_known?: boolean;
  personality_mutations?: Array<Record<string, unknown>>;
  baseline_untracked?: string[];
  selector?: Record<string, unknown> | null;
  blast_radius_estimate?: Record<string, unknown> | null;
  selected_capsule_id?: string;
  run_id?: string;
  [key: string]: unknown;
}

export interface SolidifyLastSolidify {
  run_id: string;
  at: string;
  event_id: string;
  capsule_id: string | null;
  outcome: { status: string; score: number };
}

export interface CapsuleEntry {
  type: string;
  schema_version?: string;
  id: string;
  trigger?: string[];
  gene?: string | null;
  summary?: string;
  confidence?: number;
  blast_radius?: { files: number; lines: number };
  outcome?: { status: string; score: number };
  success_streak?: number;
  env_fingerprint?: EnvFingerprint;
  a2a?: { eligible_to_broadcast: boolean };
  asset_id?: string | null;
  [key: string]: unknown;
}

export interface ValidationRunResult {
  ok: boolean;
  results: ValidationCmdResult[];
  startedAt: number | null;
  finishedAt: number | null;
}

export interface ValidationCmdResult {
  cmd: string;
  ok: boolean;
  out: string;
  err: string;
}

export interface EvolutionEvent {
  type: "EvolutionEvent";
  schema_version: string;
  id: string;
  parent: string | null;
  intent: string;
  signals: string[];
  genes_used: string[];
  mutation_id: string | null;
  personality_state: PersonalityState | null;
  blast_radius: { files: number; lines: number };
  outcome: { status: string; score: number };
  capsule_id: string | null;
  env_fingerprint: EnvFingerprint;
  validation_report_id: string;
  meta: Record<string, unknown>;
  asset_id?: string | null;
}

export interface SrcValidationResult {
  ok: boolean;
  violations: string[];
  high_risk_files: string[];
  requires_extra_validation: boolean;
}

export interface SandboxRunResult {
  ok: boolean;
  mode: string;
  results: Array<Record<string, unknown>>;
  elapsed_ms: number;
  error: string | null;
}

export interface EnsureGeneResult {
  gene: GeneEntry;
  created: boolean;
  reason: string;
}

export interface SessionInputs {
  recentSessionTranscript: string;
  todayLog: string;
  memorySnippet: string;
  userSnippet: string;
}

export interface SolidifyOptions {
  intent?: string;
  summary?: string;
  dryRun?: boolean;
  rollbackOnFailure?: boolean;
}

export interface SolidifyResult {
  ok: boolean;
  event?: EvolutionEvent;
  capsule?: CapsuleEntry | null;
  gene?: GeneEntry | null;
  constraintCheck?: ConstraintCheckResult;
  validation?: ValidationRunResult;
  validationReport?: ValidationReport;
  blast?: BlastRadius;
  reason?: string;
  sandboxResult?: SandboxRunResult | null;
  srcValidation?: SrcValidationResult | null;
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function clamp01(x: unknown): number {
  const n = Number(x);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(1, n));
}

function _safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
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
  } catch {
    return fallback;
  }
}

function stableHash(input: unknown): string {
  const s =
    typeof input === "string"
      ? input
      : typeof input === "number" || typeof input === "boolean"
        ? String(input)
        : "";
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function runCmd(cmd: string, opts: RunCmdOpts = {}): string {
  const cwd = opts.cwd || getRepoRoot();
  const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 120000;
  return execSync(cmd, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });
}

function tryRunCmd(cmd: string, opts: RunCmdOpts = {}): CmdResult {
  try {
    return { ok: true, out: runCmd(cmd, opts), err: "" };
  } catch (e: unknown) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    const stderr = err && err.stderr ? String(err.stderr) : "";
    const stdout = err && err.stdout ? String(err.stdout) : "";
    const msg = err && err.message ? String(err.message) : "command_failed";
    return { ok: false, out: stdout, err: stderr || msg };
  }
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function gitListChangedFiles({ repoRoot }: { repoRoot: string }): string[] {
  const files = new Set<string>();
  const s1 = tryRunCmd("git diff --name-only", { cwd: repoRoot, timeoutMs: 60000 });
  if (s1.ok) {
    for (const line of String(s1.out)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)) {
      files.add(line);
    }
  }
  const s2 = tryRunCmd("git diff --cached --name-only", { cwd: repoRoot, timeoutMs: 60000 });
  if (s2.ok) {
    for (const line of String(s2.out)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)) {
      files.add(line);
    }
  }
  const s3 = tryRunCmd("git ls-files --others --exclude-standard", {
    cwd: repoRoot,
    timeoutMs: 60000,
  });
  if (s3.ok) {
    for (const line of String(s3.out)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)) {
      files.add(line);
    }
  }
  return Array.from(files);
}

function parseNumstat(text: string | undefined | null): NumstatResult {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let added = 0;
  let deleted = 0;
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }
    const a = Number(parts[0]);
    const d = Number(parts[1]);
    if (Number.isFinite(a)) {
      added += a;
    }
    if (Number.isFinite(d)) {
      deleted += d;
    }
  }
  return { added, deleted };
}

function countFileLines(absPath: string): number {
  try {
    if (!fs.existsSync(absPath)) {
      return 0;
    }
    const buf = fs.readFileSync(absPath);
    if (!buf || buf.length === 0) {
      return 0;
    }
    let n = 1;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 10) {
        n++;
      }
    }
    return n;
  } catch {
    return 0;
  }
}

function computeBlastRadius({
  repoRoot,
  baselineUntracked,
}: {
  repoRoot: string;
  baselineUntracked?: string[];
}): BlastRadius {
  let changedFiles = gitListChangedFiles({ repoRoot });
  if (Array.isArray(baselineUntracked) && baselineUntracked.length > 0) {
    const baselineSet = new Set(baselineUntracked);
    changedFiles = changedFiles.filter((f) => !baselineSet.has(f));
  }
  const filesCount = changedFiles.length;
  const u = tryRunCmd("git diff --numstat", { cwd: repoRoot, timeoutMs: 60000 });
  const c = tryRunCmd("git diff --cached --numstat", { cwd: repoRoot, timeoutMs: 60000 });
  const unstaged = u.ok ? parseNumstat(u.out) : { added: 0, deleted: 0 };
  const staged = c.ok ? parseNumstat(c.out) : { added: 0, deleted: 0 };
  const untracked = tryRunCmd("git ls-files --others --exclude-standard", {
    cwd: repoRoot,
    timeoutMs: 60000,
  });
  let untrackedLines = 0;
  if (untracked.ok) {
    const rels = String(untracked.out)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const baselineSet = new Set(Array.isArray(baselineUntracked) ? baselineUntracked : []);
    for (const rel of rels) {
      if (baselineSet.has(rel)) {
        continue;
      }
      const abs = path.join(repoRoot, rel);
      untrackedLines += countFileLines(abs);
    }
  }
  const churn = unstaged.added + unstaged.deleted + staged.added + staged.deleted + untrackedLines;
  return { files: filesCount, lines: churn, changed_files: changedFiles };
}

// ---------------------------------------------------------------------------
// Constraint checking
// ---------------------------------------------------------------------------

function isForbiddenPath(relPath: string | undefined | null, forbiddenPaths: string[]): boolean {
  const rel = String(relPath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
  const list = Array.isArray(forbiddenPaths) ? forbiddenPaths : [];
  for (const fp of list) {
    const f = String(fp || "")
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+$/, "");
    if (!f) {
      continue;
    }
    if (rel === f) {
      return true;
    }
    if (rel.startsWith(f + "/")) {
      return true;
    }
  }
  return false;
}

function checkConstraints({
  gene,
  blast,
}: {
  gene: GeneEntry | null;
  blast: BlastRadius;
}): ConstraintCheckResult {
  const violations: string[] = [];
  if (!gene || gene.type !== "Gene") {
    return { ok: true, violations };
  }
  const constraints = gene.constraints || {};
  const maxFiles = Number(constraints.max_files);
  if (Number.isFinite(maxFiles) && maxFiles > 0) {
    if (Number(blast.files) > maxFiles) {
      violations.push(`max_files exceeded: ${blast.files} > ${maxFiles}`);
    }
  }
  const forbidden = Array.isArray(constraints.forbidden_paths)
    ? (constraints.forbidden_paths as string[])
    : [];
  for (const f of blast.changed_files || []) {
    if (isForbiddenPath(f, forbidden)) {
      violations.push(`forbidden_path touched: ${f}`);
    }
  }
  return { ok: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

export function readStateForSolidify(): SolidifyState {
  const _memoryDir = getMemoryDir();
  const statePath = path.join(getEvolutionDir(), "evolution_solidify_state.json");
  return readJsonIfExists<SolidifyState>(statePath, { last_run: null });
}

export function writeStateForSolidify(state: SolidifyState): void {
  const memoryDir = getMemoryDir();
  const statePath = path.join(getEvolutionDir(), "evolution_solidify_state.json");
  try {
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }
  } catch {
    // ignored
  }
  const tmp = `${statePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, statePath);
}

// ---------------------------------------------------------------------------
// ID builders
// ---------------------------------------------------------------------------

function buildEventId(tsIso: string): string {
  const t = Date.parse(tsIso);
  return `evt_${Number.isFinite(t) ? t : Date.now()}`;
}

function buildCapsuleId(tsIso: string): string {
  const t = Date.parse(tsIso);
  return `capsule_${Number.isFinite(t) ? t : Date.now()}`;
}

// ---------------------------------------------------------------------------
// Validation command safety
// ---------------------------------------------------------------------------

const VALIDATION_ALLOWED_PREFIXES: string[] = ["node ", "npm ", "npx "];

export function isValidationCommandAllowed(cmd: string | undefined | null): boolean {
  const c = String(cmd || "").trim();
  if (!c) {
    return false;
  }
  if (!VALIDATION_ALLOWED_PREFIXES.some((p) => c.startsWith(p))) {
    return false;
  }
  if (/`|\$\(/.test(c)) {
    return false;
  }
  const stripped = c.replace(/"[^"]*"/g, "").replace(/'[^']*'/g, "");
  if (/[;&|><]/.test(stripped)) {
    return false;
  }
  return true;
}

function runValidations(gene: GeneEntry | null, opts: RunCmdOpts = {}): ValidationRunResult {
  const repoRoot = opts.cwd || getRepoRoot();
  const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 180000;
  const validation = Array.isArray(gene && gene.validation) ? gene!.validation! : [];
  const results: ValidationCmdResult[] = [];
  const startedAt = Date.now();
  for (const cmd of validation) {
    const c = String(cmd || "").trim();
    if (!c) {
      continue;
    }
    if (!isValidationCommandAllowed(c)) {
      results.push({
        cmd: c,
        ok: false,
        out: "",
        err: "BLOCKED: validation command rejected by safety check (allowed prefixes: node/npm/npx; shell operators prohibited)",
      });
      return { ok: false, results, startedAt, finishedAt: Date.now() };
    }
    const r = tryRunCmd(c, { cwd: repoRoot, timeoutMs });
    results.push({ cmd: c, ok: r.ok, out: String(r.out || ""), err: String(r.err || "") });
    if (!r.ok) {
      return { ok: false, results, startedAt, finishedAt: Date.now() };
    }
  }
  return { ok: true, results, startedAt, finishedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Rollback helpers
// ---------------------------------------------------------------------------

function rollbackTracked(repoRoot: string): void {
  tryRunCmd("git restore --staged --worktree .", { cwd: repoRoot, timeoutMs: 60000 });
  tryRunCmd("git reset --hard", { cwd: repoRoot, timeoutMs: 60000 });
}

function gitListUntrackedFiles(repoRoot: string): string[] {
  const r = tryRunCmd("git ls-files --others --exclude-standard", {
    cwd: repoRoot,
    timeoutMs: 60000,
  });
  if (!r.ok) {
    return [];
  }
  return String(r.out)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function rollbackNewUntrackedFiles({
  repoRoot,
  baselineUntracked,
}: {
  repoRoot: string;
  baselineUntracked?: string[];
}): { deleted: string[] } {
  const baseline = new Set((Array.isArray(baselineUntracked) ? baselineUntracked : []).map(String));
  const current = gitListUntrackedFiles(repoRoot);
  const toDelete = current.filter((f) => !baseline.has(String(f)));
  for (const rel of toDelete) {
    const safeRel = String(rel || "")
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "");
    if (!safeRel) {
      continue;
    }
    const abs = path.join(repoRoot, safeRel);
    const normRepo = path.resolve(repoRoot);
    const normAbs = path.resolve(abs);
    if (!normAbs.startsWith(normRepo + path.sep) && normAbs !== normRepo) {
      continue;
    }
    try {
      if (fs.existsSync(normAbs) && fs.statSync(normAbs).isFile()) {
        fs.unlinkSync(normAbs);
      }
    } catch {
      // ignored
    }
  }
  return { deleted: toDelete };
}

// ---------------------------------------------------------------------------
// Gene helpers
// ---------------------------------------------------------------------------

function inferCategoryFromSignals(signals: string[]): string {
  const list = Array.isArray(signals) ? signals.map(String) : [];
  if (list.includes("log_error")) {
    return "repair";
  }
  if (list.includes("protocol_drift")) {
    return "optimize";
  }
  return "optimize";
}

function buildAutoGene({ signals, intent }: { signals?: string[]; intent?: string }): GeneEntry {
  const sigs = Array.isArray(signals)
    ? Array.from(new Set(signals.map(String))).filter(Boolean)
    : [];
  const signalKey = computeSignalKey(sigs);
  const id = `gene_auto_${stableHash(signalKey)}`;
  const category =
    intent && ["repair", "optimize", "innovate"].includes(String(intent))
      ? String(intent)
      : inferCategoryFromSignals(sigs);
  const signalsMatch = sigs.length ? sigs.slice(0, 8) : ["(none)"];
  const gene: GeneEntry = {
    type: "Gene",
    schema_version: SCHEMA_VERSION,
    id,
    category,
    signals_match: signalsMatch,
    preconditions: [`signals_key == ${signalKey}`],
    strategy: [
      "Extract structured signals from logs and user instructions",
      "Select an existing Gene by signals match (no improvisation)",
      "Estimate blast radius (files, lines) before editing and record it",
      "Apply smallest reversible patch",
      "Validate using declared validation steps; rollback on failure",
      "Solidify knowledge: append EvolutionEvent, update Gene/Capsule store",
    ],
    constraints: { max_files: 12, forbidden_paths: [".git", "node_modules"] },
    validation: ["node -e \"console.log('ok')\""],
  };
  gene.asset_id = computeAssetId(gene as unknown as Record<string, unknown>);
  return gene;
}

function ensureGene({
  genes,
  selectedGene,
  signals,
  intent,
  dryRun,
}: {
  genes: GeneEntry[];
  selectedGene: GeneEntry | null | undefined;
  signals: string[];
  intent?: string;
  dryRun?: boolean;
}): EnsureGeneResult {
  if (selectedGene && selectedGene.type === "Gene") {
    return { gene: selectedGene, created: false, reason: "selected_gene_id_present" };
  }
  const res = selectGene(
    Array.isArray(genes)
      ? (genes as Array<{
          type: "Gene";
          id: string;
          signals_match?: string[];
          [key: string]: unknown;
        }>)
      : [],
    Array.isArray(signals) ? signals : [],
    {
      bannedGeneIds: new Set<string>(),
      preferredGeneId: null,
      driftEnabled: false,
    },
  );
  if (res && res.selected) {
    return {
      gene: res.selected as unknown as GeneEntry,
      created: false,
      reason: "reselected_from_existing",
    };
  }
  const auto = buildAutoGene({ signals, intent });
  if (!dryRun) {
    upsertGene(
      auto as Record<string, unknown> & {
        type: string;
        id: string;
        category: string;
        signals_match: string[];
        preconditions: string[];
        strategy: string[];
        constraints: Record<string, unknown>;
        validation: string[];
      },
    );
  }
  return { gene: auto, created: true, reason: "no_match_create_new" };
}

// ---------------------------------------------------------------------------
// Session inputs
// ---------------------------------------------------------------------------

function readRecentSessionInputs(): SessionInputs {
  const repoRoot = getRepoRoot();
  const memoryDir = getMemoryDir();
  const rootMemory = path.join(repoRoot, "MEMORY.md");
  const dirMemory = path.join(memoryDir, "MEMORY.md");
  const memoryFile = fs.existsSync(rootMemory) ? rootMemory : dirMemory;
  const userFile = path.join(repoRoot, "USER.md");
  const todayLog = path.join(memoryDir, new Date().toISOString().split("T")[0] + ".md");
  const todayLogContent = fs.existsSync(todayLog) ? fs.readFileSync(todayLog, "utf8") : "";
  const memorySnippet = fs.existsSync(memoryFile)
    ? fs.readFileSync(memoryFile, "utf8").slice(0, 50000)
    : "";
  const userSnippet = fs.existsSync(userFile) ? fs.readFileSync(userFile, "utf8") : "";
  const recentSessionTranscript = "";
  return { recentSessionTranscript, todayLog: todayLogContent, memorySnippet, userSnippet };
}

// ---------------------------------------------------------------------------
// Main solidify function
// ---------------------------------------------------------------------------

export function solidify({
  intent,
  summary,
  dryRun = false,
  rollbackOnFailure = true,
}: SolidifyOptions = {}): SolidifyResult {
  const repoRoot = getRepoRoot();
  const state = readStateForSolidify();
  const lastRun: SolidifyLastRun | null = state && state.last_run ? state.last_run : null;
  const genes = loadGenes();
  const geneId = lastRun && lastRun.selected_gene_id ? String(lastRun.selected_gene_id) : null;
  const selectedGene = geneId
    ? (genes as unknown as GeneEntry[]).find((g) => g && g.type === "Gene" && g.id === geneId) ||
      null
    : null;
  const parentEventId =
    lastRun && typeof lastRun.parent_event_id === "string"
      ? lastRun.parent_event_id
      : getLastEventId();
  const signals: string[] =
    lastRun && Array.isArray(lastRun.signals) && lastRun.signals.length
      ? Array.from(new Set(lastRun.signals.map(String)))
      : extractSignals(readRecentSessionInputs());
  const signalKey = computeSignalKey(signals);

  const mutationRaw: Record<string, unknown> | null =
    lastRun && lastRun.mutation && typeof lastRun.mutation === "object" ? lastRun.mutation : null;
  const personalityRaw: Record<string, unknown> | null =
    lastRun && lastRun.personality_state && typeof lastRun.personality_state === "object"
      ? lastRun.personality_state
      : null;
  const mutation: Mutation | null =
    mutationRaw && isValidMutation(mutationRaw) ? normalizeMutation(mutationRaw) : null;
  const personalityState: PersonalityState | null =
    personalityRaw && isValidPersonalityState(personalityRaw)
      ? normalizePersonalityState(personalityRaw)
      : null;
  const personalityKeyUsed = personalityState ? personalityKey(personalityState) : null;
  const protocolViolations: string[] = [];
  if (!mutation) {
    protocolViolations.push("missing_or_invalid_mutation");
  }
  if (!personalityState) {
    protocolViolations.push("missing_or_invalid_personality_state");
  }
  if (
    mutation &&
    mutation.risk_level === "high" &&
    !isHighRiskMutationAllowed(personalityState || null)
  ) {
    protocolViolations.push("high_risk_mutation_not_allowed_by_personality");
  }
  if (mutation && mutation.risk_level === "high" && !(lastRun && lastRun.personality_known)) {
    protocolViolations.push("high_risk_mutation_forbidden_under_unknown_personality");
  }
  if (
    mutation &&
    mutation.category === "innovate" &&
    personalityState &&
    isHighRiskPersonality(personalityState)
  ) {
    protocolViolations.push("forbidden_innovate_with_high_risk_personality");
  }

  const ensured = ensureGene({
    genes: genes as unknown as GeneEntry[],
    selectedGene,
    signals,
    intent,
    dryRun: !!dryRun,
  });
  const geneUsed = ensured.gene;
  const blast = computeBlastRadius({
    repoRoot,
    baselineUntracked:
      lastRun && Array.isArray(lastRun.baseline_untracked) ? lastRun.baseline_untracked : [],
  });
  const constraintCheck = checkConstraints({ gene: geneUsed, blast });

  // --- src/ change sandbox testing ---
  const isSrcChange = (blast.changed_files || []).some((f: string) => String(f).startsWith("src/"));
  let sandboxResult: SandboxRunResult | null = null;
  let srcValidation: SrcValidationResult | null = null;

  if (isSrcChange && !dryRun) {
    // Check src/-specific constraints
    srcValidation = validateSrcChanges(
      blast.changed_files,
      blast as unknown as SrcBlastRadius,
    ) as SrcValidationResult;

    // Run full tests in sandbox
    sandboxResult = runInSandbox({ workspaceRoot: repoRoot }) as unknown as SandboxRunResult;

    if (!sandboxResult.ok) {
      // Sandbox test failed -- record error
      recordError({
        errorType: "sandbox_test_failed",
        errorMessage: sandboxResult.error || "sandbox test failed",
        changedFiles: blast.changed_files,
        blastRadius: { files: blast.files, lines: blast.lines },
        testResults: sandboxResult as unknown as Record<string, unknown>,
      });

      if (rollbackOnFailure) {
        rollbackTracked(repoRoot);
        rollbackNewUntrackedFiles({
          repoRoot,
          baselineUntracked:
            lastRun && Array.isArray(lastRun.baseline_untracked) ? lastRun.baseline_untracked : [],
        });
      }

      return {
        ok: false,
        reason: "sandbox_test_failed",
        sandboxResult,
        srcValidation,
        blast,
        gene: geneUsed,
      };
    }
  }

  // Capture environment fingerprint before validation.
  const envFp = captureEnvFingerprint();

  let validation: ValidationRunResult = {
    ok: true,
    results: [],
    startedAt: null,
    finishedAt: null,
  };
  if (geneUsed) {
    validation = runValidations(geneUsed, { cwd: repoRoot, timeoutMs: 180000 });
  }

  // Build standardized ValidationReport (machine-readable, interoperable).
  const validationReport = buildValidationReport({
    geneId: geneUsed && geneUsed.id ? geneUsed.id : null,
    commands: validation.results.map(function (r: ValidationCmdResult): string {
      return r.cmd;
    }),
    results: validation.results,
    envFp: envFp,
    startedAt: validation.startedAt ?? undefined,
    finishedAt: validation.finishedAt ?? undefined,
  });

  const success = constraintCheck.ok && validation.ok && protocolViolations.length === 0;
  const ts = nowIso();
  const outcomeStatus = success ? "success" : "failed";
  const score = clamp01(success ? 0.85 : 0.2);

  const selectedCapsuleId =
    lastRun && typeof lastRun.selected_capsule_id === "string" && lastRun.selected_capsule_id.trim()
      ? String(lastRun.selected_capsule_id).trim()
      : null;
  const capsuleId = success ? selectedCapsuleId || buildCapsuleId(ts) : null;
  const derivedIntent =
    intent || (mutation && mutation.category) || (geneUsed && geneUsed.category) || "repair";
  const intentMismatch =
    intent &&
    mutation &&
    typeof mutation.category === "string" &&
    String(intent) !== String(mutation.category);
  if (intentMismatch) {
    protocolViolations.push(
      `intent_mismatch_with_mutation:${String(intent)}!=${String(mutation.category)}`,
    );
  }

  const event: EvolutionEvent = {
    type: "EvolutionEvent",
    schema_version: SCHEMA_VERSION,
    id: buildEventId(ts),
    parent: parentEventId || null,
    intent: derivedIntent,
    signals,
    genes_used: geneUsed && geneUsed.id ? [geneUsed.id] : [],
    mutation_id: mutation && mutation.id ? mutation.id : null,
    personality_state: personalityState || null,
    blast_radius: { files: blast.files, lines: blast.lines },
    outcome: { status: outcomeStatus, score },
    capsule_id: capsuleId,
    env_fingerprint: envFp,
    validation_report_id: validationReport.id,
    meta: {
      at: ts,
      signal_key: signalKey,
      selector: lastRun && lastRun.selector ? lastRun.selector : null,
      blast_radius_estimate:
        lastRun && lastRun.blast_radius_estimate ? lastRun.blast_radius_estimate : null,
      mutation: mutation || null,
      personality: {
        key: personalityKeyUsed,
        known: !!(lastRun && lastRun.personality_known),
        mutations:
          lastRun && Array.isArray(lastRun.personality_mutations)
            ? lastRun.personality_mutations
            : [],
      },
      gene: {
        id: geneUsed && geneUsed.id ? geneUsed.id : null,
        created: !!ensured.created,
        reason: ensured.reason,
      },
      constraints_ok: constraintCheck.ok,
      constraint_violations: constraintCheck.violations,
      validation_ok: validation.ok,
      validation: validation.results.map((r: ValidationCmdResult) => ({ cmd: r.cmd, ok: r.ok })),
      validation_report: validationReport,
      protocol_ok: protocolViolations.length === 0,
      protocol_violations: protocolViolations,
      sandbox: sandboxResult
        ? { ok: sandboxResult.ok, mode: sandboxResult.mode, elapsed_ms: sandboxResult.elapsed_ms }
        : null,
      src_validation: srcValidation || null,
      is_src_change: isSrcChange,
      memory_graph: memoryGraphPath(),
    },
  };
  event.asset_id = computeAssetId(event as unknown as Record<string, unknown>);

  let capsule: CapsuleEntry | null = null;
  if (success) {
    const s = String(summary || "").trim();
    const autoSummary = geneUsed
      ? `Solidify: ${geneUsed.id} matched signals ${signals.join(", ") || "(none)"}, changed ${blast.files} files / ${blast.lines} lines.`
      : `Solidify: matched signals ${signals.join(", ") || "(none)"}, changed ${blast.files} files / ${blast.lines} lines.`;
    let prevCapsule: CapsuleEntry | null = null;
    try {
      if (selectedCapsuleId) {
        const list = loadCapsules();
        prevCapsule = Array.isArray(list)
          ? (list.find(
              (c) => c && c.type === "Capsule" && String(c.id) === selectedCapsuleId,
            ) as unknown as CapsuleEntry) || null
          : null;
      }
    } catch {
      // ignored
    }
    capsule = {
      type: "Capsule",
      schema_version: SCHEMA_VERSION,
      id: capsuleId!,
      trigger:
        prevCapsule && Array.isArray(prevCapsule.trigger) && prevCapsule.trigger.length
          ? prevCapsule.trigger
          : signals,
      gene:
        geneUsed && geneUsed.id
          ? geneUsed.id
          : prevCapsule && prevCapsule.gene
            ? prevCapsule.gene
            : null,
      summary:
        s || (prevCapsule && prevCapsule.summary ? String(prevCapsule.summary) : autoSummary),
      confidence: clamp01(score),
      blast_radius: { files: blast.files, lines: blast.lines },
      outcome: { status: "success", score },
      success_streak: 1,
      env_fingerprint: envFp,
      a2a: { eligible_to_broadcast: false },
    };
    capsule.asset_id = computeAssetId(capsule as unknown as Record<string, unknown>);
  }

  // Bug fix: dry-run must NOT trigger rollback (it should only observe, not mutate).
  if (!dryRun && !success && rollbackOnFailure) {
    rollbackTracked(repoRoot);
    rollbackNewUntrackedFiles({
      repoRoot,
      baselineUntracked: lastRun && lastRun.baseline_untracked ? lastRun.baseline_untracked : [],
    });
  }

  if (!dryRun) {
    appendEventJsonl(validationReport as unknown as Record<string, unknown>);
    if (capsule) {
      upsertCapsule(capsule as unknown as { type: string; id: string; [key: string]: unknown });
    }
    appendEventJsonl(event as unknown as Record<string, unknown>);
    if (capsule) {
      const streak = computeCapsuleSuccessStreak({ capsuleId: capsule.id });
      capsule.success_streak = streak || 1;
      capsule.a2a = {
        eligible_to_broadcast:
          isBlastRadiusSafe(capsule.blast_radius) &&
          (capsule.outcome?.score || 0) >= 0.7 &&
          (capsule.success_streak || 0) >= 2,
      };
      capsule.asset_id = computeAssetId(capsule as unknown as Record<string, unknown>);
      upsertCapsule(capsule as unknown as { type: string; id: string; [key: string]: unknown });
    }
    try {
      if (personalityState) {
        updatePersonalityStats({
          personalityState,
          outcome: outcomeStatus,
          score,
          notes: `event:${event.id}`,
        });
      }
    } catch {
      // ignored
    }
  }

  const runId =
    lastRun && lastRun.run_id
      ? String(lastRun.run_id)
      : stableHash(`${parentEventId || "root"}|${geneId || "none"}|${signalKey}`);
  state.last_solidify = {
    run_id: runId,
    at: ts,
    event_id: event.id,
    capsule_id: capsuleId,
    outcome: event.outcome,
  };
  if (!dryRun) {
    writeStateForSolidify(state);
  }

  return {
    ok: success,
    event,
    capsule,
    gene: geneUsed,
    constraintCheck,
    validation,
    validationReport,
    blast,
  };
}
