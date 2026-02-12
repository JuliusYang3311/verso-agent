import type { VersoConfig } from "../../config/config.js";
import type { SkillEntry, SkillSnapshot } from "./types.js";
import { resolveSkillConfig } from "./config.js";
import { resolveSkillKey } from "./frontmatter.js";

function applyConfigEnvOverrides(
  config: VersoConfig | undefined,
  updates: Array<{ key: string; prev: string | undefined }>,
) {
  const entries = config?.skills?.entries;
  if (!entries || typeof entries !== "object") {
    return;
  }

  for (const entry of Object.values(entries)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const env = (entry as { env?: Record<string, string> }).env;
    if (!env || typeof env !== "object") {
      continue;
    }
    for (const [envKey, envValue] of Object.entries(env)) {
      if (!envValue || process.env[envKey]) {
        continue;
      }
      updates.push({ key: envKey, prev: process.env[envKey] });
      process.env[envKey] = envValue;
    }
  }
}

export function applySkillEnvOverrides(params: { skills: SkillEntry[]; config?: VersoConfig }) {
  const { skills, config } = params;
  const updates: Array<{ key: string; prev: string | undefined }> = [];

  for (const entry of skills) {
    const skillKey = resolveSkillKey(entry.skill, entry);
    const skillConfig = resolveSkillConfig(config, skillKey);
    if (!skillConfig) {
      continue;
    }

    if (skillConfig.env) {
      for (const [envKey, envValue] of Object.entries(skillConfig.env)) {
        if (!envValue || process.env[envKey]) {
          continue;
        }
        updates.push({ key: envKey, prev: process.env[envKey] });
        process.env[envKey] = envValue;
      }
    }

    const primaryEnv = entry.metadata?.primaryEnv;
    if (primaryEnv && skillConfig.apiKey && !process.env[primaryEnv]) {
      updates.push({ key: primaryEnv, prev: process.env[primaryEnv] });
      process.env[primaryEnv] = skillConfig.apiKey;
    }
  }

  applyConfigEnvOverrides(config, updates);

  return () => {
    for (const update of updates) {
      if (update.prev === undefined) {
        delete process.env[update.key];
      } else {
        process.env[update.key] = update.prev;
      }
    }
  };
}

export function applySkillEnvOverridesFromSnapshot(params: {
  snapshot?: SkillSnapshot;
  config?: VersoConfig;
}) {
  const { snapshot, config } = params;
  if (!snapshot) {
    return () => {};
  }
  const updates: Array<{ key: string; prev: string | undefined }> = [];

  for (const skill of snapshot.skills) {
    const skillConfig = resolveSkillConfig(config, skill.name);
    if (!skillConfig) {
      continue;
    }

    if (skillConfig.env) {
      for (const [envKey, envValue] of Object.entries(skillConfig.env)) {
        if (!envValue || process.env[envKey]) {
          continue;
        }
        updates.push({ key: envKey, prev: process.env[envKey] });
        process.env[envKey] = envValue;
      }
    }

    if (skill.primaryEnv && skillConfig.apiKey && !process.env[skill.primaryEnv]) {
      updates.push({
        key: skill.primaryEnv,
        prev: process.env[skill.primaryEnv],
      });
      process.env[skill.primaryEnv] = skillConfig.apiKey;
    }
  }

  applyConfigEnvOverrides(config, updates);

  return () => {
    for (const update of updates) {
      if (update.prev === undefined) {
        delete process.env[update.key];
      } else {
        process.env[update.key] = update.prev;
      }
    }
  };
}
