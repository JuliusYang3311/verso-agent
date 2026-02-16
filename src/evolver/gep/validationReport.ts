import { computeAssetId, SCHEMA_VERSION } from "./contentHash.js";
import { captureEnvFingerprint, envFingerprintKey, type EnvFingerprint } from "./envFingerprint.js";

export type ValidationReportCommand = {
  command: string;
  ok: boolean;
  stdout: string;
  stderr: string;
};

export type ValidationReport = {
  type: "ValidationReport";
  schema_version: string;
  id: string;
  gene_id: string | null;
  env_fingerprint: EnvFingerprint;
  env_fingerprint_key: string;
  commands: ValidationReportCommand[];
  overall_ok: boolean;
  duration_ms: number | null;
  created_at: string;
  asset_id?: string | null;
};

export function buildValidationReport(params: {
  geneId?: string | null;
  commands?: string[];
  results?: Array<{ ok?: boolean; cmd?: string; out?: string; err?: string }>;
  envFp?: EnvFingerprint | null;
  startedAt?: number;
  finishedAt?: number;
}): ValidationReport {
  const env = params.envFp || captureEnvFingerprint();
  const resultsList = Array.isArray(params.results) ? params.results : [];
  const cmdsList = Array.isArray(params.commands)
    ? params.commands
    : resultsList.map((r) => (r && r.cmd ? String(r.cmd) : ""));
  const overallOk = resultsList.length > 0 && resultsList.every((r) => r && r.ok);
  const durationMs =
    Number.isFinite(params.startedAt) && Number.isFinite(params.finishedAt)
      ? params.finishedAt! - params.startedAt!
      : null;

  const report: ValidationReport = {
    type: "ValidationReport",
    schema_version: SCHEMA_VERSION,
    id: "vr_" + Date.now(),
    gene_id: params.geneId || null,
    env_fingerprint: env,
    env_fingerprint_key: envFingerprintKey(env),
    commands: cmdsList.map((cmd, i) => {
      const r = resultsList[i] || {};
      return {
        command: String(cmd || ""),
        ok: !!r.ok,
        stdout: String(r.out || "").slice(0, 4000),
        stderr: String(r.err || "").slice(0, 4000),
      };
    }),
    overall_ok: overallOk,
    duration_ms: durationMs,
    created_at: new Date().toISOString(),
  };

  report.asset_id = computeAssetId(report as unknown as Record<string, unknown>);
  return report;
}

export function isValidValidationReport(obj: unknown): obj is ValidationReport {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  const r = obj as Record<string, unknown>;
  if (r.type !== "ValidationReport") {
    return false;
  }
  if (!r.id || typeof r.id !== "string") {
    return false;
  }
  if (!Array.isArray(r.commands)) {
    return false;
  }
  if (typeof r.overall_ok !== "boolean") {
    return false;
  }
  return true;
}
