import type { VersoConfig } from "./types.js";

export function collectConfigEnvVars(cfg?: VersoConfig): Record<string, string> {
  const entries: Record<string, string> = {};
  const envConfig = cfg?.env;

  if (envConfig?.vars) {
    for (const [key, value] of Object.entries(envConfig.vars)) {
      if (!value) continue;
      entries[key] = value;
    }
  }

  if (envConfig) {
    for (const [key, value] of Object.entries(envConfig)) {
      if (key === "shellEnv" || key === "vars") continue;
      if (typeof value !== "string" || !value.trim()) continue;
      entries[key] = value;
    }
  }

  if (cfg?.moltbook?.apiKey) {
    entries.MOLTBOOK_API_KEY = cfg.moltbook.apiKey;
  }

  if (cfg?.crypto?.alchemyApiKey) {
    entries.ALCHEMY_API_KEY = cfg.crypto.alchemyApiKey;
  }
  if (cfg?.crypto?.solanaPrivateKey) {
    entries.SOLANA_PRIVATE_KEY = cfg.crypto.solanaPrivateKey;
  }

  return entries;
}
