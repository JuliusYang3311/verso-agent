import fs from "node:fs";
import path from "node:path";
import { computeAssetId, SCHEMA_VERSION } from "./contentHash.js";
import { getGepAssetsDir } from "./paths.js";

interface GeneEntry {
  type: string;
  id: string;
  category: string;
  signals_match: string[];
  preconditions: string[];
  strategy: string[];
  constraints: Record<string, unknown>;
  validation: string[];
  schema_version?: string;
  asset_id?: string;
  [key: string]: unknown;
}

interface GenesFile {
  version: number;
  genes: GeneEntry[];
}

interface CapsuleEntry {
  type: string;
  id: string;
  schema_version?: string;
  asset_id?: string;
  [key: string]: unknown;
}

interface CapsulesFile {
  version: number;
  capsules: CapsuleEntry[];
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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

function writeJsonAtomic(filePath: string, obj: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

function getDefaultGenes(): GenesFile {
  return {
    version: 1,
    genes: [
      {
        type: "Gene",
        id: "gene_gep_repair_from_errors",
        category: "repair",
        signals_match: ["error", "exception", "failed", "unstable"],
        preconditions: ["signals contains error-related indicators"],
        strategy: [
          "Extract structured signals from logs and user instructions",
          "Select an existing Gene by signals match (no improvisation)",
          "Estimate blast radius (files, lines) before editing",
          "Apply smallest reversible patch",
          "Validate using declared validation steps; rollback on failure",
          "Solidify knowledge: append EvolutionEvent, update Gene/Capsule store",
        ],
        constraints: { max_files: 12, forbidden_paths: [".git", "node_modules"] },
        validation: [
          "node -e \"require('./src/evolve'); require('./src/gep/solidify'); console.log('ok')\"",
          "node -e \"require('./src/gep/selector'); require('./src/gep/memoryGraph'); console.log('ok')\"",
        ],
      },
      {
        type: "Gene",
        id: "gene_gep_optimize_prompt_and_assets",
        category: "optimize",
        signals_match: ["protocol", "gep", "prompt", "audit", "reusable"],
        preconditions: ["need stricter, auditable evolution protocol outputs"],
        strategy: [
          "Extract signals and determine selection rationale via Selector JSON",
          "Prefer reusing existing Gene/Capsule; only create if no match exists",
          "Refactor prompt assembly to embed assets (genes, capsules, parent event)",
          "Reduce noise and ambiguity; enforce strict output schema",
          "Validate by running pnpm evolve run and ensuring no runtime errors",
          "Solidify: record EvolutionEvent, update Gene definitions, create Capsule on success",
        ],
        constraints: { max_files: 20, forbidden_paths: [".git", "node_modules"] },
        validation: [
          "node -e \"require('./src/evolve'); require('./src/gep/prompt'); console.log('ok')\"",
        ],
      },
    ],
  };
}

function getDefaultCapsules(): CapsulesFile {
  return { version: 1, capsules: [] };
}

export function genesPath(): string {
  return path.join(getGepAssetsDir(), "genes.json");
}

export function capsulesPath(): string {
  return path.join(getGepAssetsDir(), "capsules.json");
}

export function eventsPath(): string {
  return path.join(getGepAssetsDir(), "events.jsonl");
}

export function candidatesPath(): string {
  return path.join(getGepAssetsDir(), "candidates.jsonl");
}

export function externalCandidatesPath(): string {
  return path.join(getGepAssetsDir(), "external_candidates.jsonl");
}

export function loadGenes(): GeneEntry[] {
  return readJsonIfExists<GenesFile>(genesPath(), getDefaultGenes()).genes || [];
}

export function loadCapsules(): CapsuleEntry[] {
  return readJsonIfExists<CapsulesFile>(capsulesPath(), getDefaultCapsules()).capsules || [];
}

export function getLastEventId(): string | null {
  try {
    const p = eventsPath();
    if (!fs.existsSync(p)) {
      return null;
    }
    const raw = fs.readFileSync(p, "utf8");
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return null;
    }
    const last = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
    return last && typeof last.id === "string" ? last.id : null;
  } catch {
    return null;
  }
}

export function readAllEvents(): Record<string, unknown>[] {
  try {
    const p = eventsPath();
    if (!fs.existsSync(p)) {
      return [];
    }
    const raw = fs.readFileSync(p, "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l): Record<string, unknown> | null => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((item): item is Record<string, unknown> => item !== null);
  } catch {
    return [];
  }
}

export function appendEventJsonl(eventObj: Record<string, unknown>): void {
  const dir = getGepAssetsDir();
  ensureDir(dir);
  fs.appendFileSync(eventsPath(), JSON.stringify(eventObj) + "\n", "utf8");
}

export function appendCandidateJsonl(candidateObj: Record<string, unknown>): void {
  const dir = getGepAssetsDir();
  ensureDir(dir);
  fs.appendFileSync(candidatesPath(), JSON.stringify(candidateObj) + "\n", "utf8");
}

export function appendExternalCandidateJsonl(obj: Record<string, unknown>): void {
  const dir = getGepAssetsDir();
  ensureDir(dir);
  fs.appendFileSync(externalCandidatesPath(), JSON.stringify(obj) + "\n", "utf8");
}

export function readRecentCandidates(limit: number = 20): Record<string, unknown>[] {
  try {
    const p = candidatesPath();
    if (!fs.existsSync(p)) {
      return [];
    }
    const raw = fs.readFileSync(p, "utf8");
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return lines
      .slice(Math.max(0, lines.length - limit))
      .map((l): Record<string, unknown> | null => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((item): item is Record<string, unknown> => item !== null);
  } catch {
    return [];
  }
}

export function readRecentExternalCandidates(limit: number = 50): Record<string, unknown>[] {
  try {
    const p = externalCandidatesPath();
    if (!fs.existsSync(p)) {
      return [];
    }
    const raw = fs.readFileSync(p, "utf8");
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return lines
      .slice(Math.max(0, lines.length - limit))
      .map((l): Record<string, unknown> | null => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((item): item is Record<string, unknown> => item !== null);
  } catch {
    return [];
  }
}

// Safety net: ensure schema_version and asset_id are present before writing.
function ensureSchemaFields(obj: Record<string, unknown>): Record<string, unknown> {
  if (!obj || typeof obj !== "object") {
    return obj;
  }
  if (!obj.schema_version) {
    obj.schema_version = SCHEMA_VERSION;
  }
  if (!obj.asset_id) {
    try {
      obj.asset_id = computeAssetId(obj);
    } catch {
      /* ignored */
    }
  }
  return obj;
}

export function upsertGene(geneObj: GeneEntry): void {
  ensureSchemaFields(geneObj as Record<string, unknown>);
  const current = readJsonIfExists<GenesFile>(genesPath(), getDefaultGenes());
  const genes: GeneEntry[] = Array.isArray(current.genes) ? current.genes : [];
  const idx = genes.findIndex((g) => g && g.id === geneObj.id);
  if (idx >= 0) {
    genes[idx] = geneObj;
  } else {
    genes.push(geneObj);
  }
  writeJsonAtomic(genesPath(), { version: current.version || 1, genes });
}

export function appendCapsule(capsuleObj: CapsuleEntry): void {
  ensureSchemaFields(capsuleObj as Record<string, unknown>);
  const current = readJsonIfExists<CapsulesFile>(capsulesPath(), getDefaultCapsules());
  const capsules: CapsuleEntry[] = Array.isArray(current.capsules) ? current.capsules : [];
  capsules.push(capsuleObj);
  writeJsonAtomic(capsulesPath(), { version: current.version || 1, capsules });
}

export function upsertCapsule(capsuleObj: CapsuleEntry): void {
  if (!capsuleObj || capsuleObj.type !== "Capsule" || !capsuleObj.id) {
    return;
  }
  ensureSchemaFields(capsuleObj as Record<string, unknown>);
  const current = readJsonIfExists<CapsulesFile>(capsulesPath(), getDefaultCapsules());
  const capsules: CapsuleEntry[] = Array.isArray(current.capsules) ? current.capsules : [];
  const idx = capsules.findIndex(
    (c) => c && c.type === "Capsule" && String(c.id) === String(capsuleObj.id),
  );
  if (idx >= 0) {
    capsules[idx] = capsuleObj;
  } else {
    capsules.push(capsuleObj);
  }
  writeJsonAtomic(capsulesPath(), { version: current.version || 1, capsules });
}
