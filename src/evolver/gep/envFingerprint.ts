import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "./paths.js";

export type EnvFingerprint = {
  node_version: string;
  platform: string;
  arch: string;
  os_release: string;
  evolver_version: string | null;
  cwd: string;
  captured_at: string;
};

export function captureEnvFingerprint(): EnvFingerprint {
  const repoRoot = getRepoRoot();
  let pkgVersion: string | null = null;
  try {
    const raw = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    pkgVersion = pkg && pkg.version ? String(pkg.version) : null;
  } catch {
    // ignore
  }

  return {
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    os_release: os.release(),
    evolver_version: pkgVersion,
    cwd: process.cwd(),
    captured_at: new Date().toISOString(),
  };
}

export function envFingerprintKey(fp: EnvFingerprint | null | undefined): string {
  if (!fp || typeof fp !== "object") {
    return "unknown";
  }
  const parts = [
    fp.node_version || "",
    fp.platform || "",
    fp.arch || "",
    fp.evolver_version || "",
  ].join("|");
  return crypto.createHash("sha256").update(parts, "utf8").digest("hex").slice(0, 16);
}

export function isSameEnvClass(
  fpA: EnvFingerprint | null | undefined,
  fpB: EnvFingerprint | null | undefined,
): boolean {
  return envFingerprintKey(fpA) === envFingerprintKey(fpB);
}
