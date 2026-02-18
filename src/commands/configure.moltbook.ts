import chalk from "chalk";
import type { VersoConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { confirm, text, intro, outro } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";

export async function promptMoltbookConfig(
  nextConfig: VersoConfig,
  runtime: RuntimeEnv,
): Promise<VersoConfig> {
  intro(chalk.bold("🦞 Moltbook Configuration"));

  const currentConfig = nextConfig.moltbook || {};

  const enabled = (await guardCancel(
    confirm({
      message: "Enable Moltbook skills?",
      initialValue: currentConfig.enabled ?? true,
    }),
    runtime,
  )) as boolean;

  if (!enabled) {
    outro(chalk.gray("Moltbook disabled."));
    return {
      ...nextConfig,
      moltbook: {
        ...currentConfig,
        enabled: false,
      },
    };
  }

  const apiKey = (await guardCancel(
    text({
      message: "Moltbook API Key",
      placeholder: "moltbook_...",
      initialValue: currentConfig.apiKey,
      validate: (value) => ((value ?? "").trim().length > 0 ? undefined : "API Key is required"),
    }),
    runtime,
  )) as string;

  const agentName = (await guardCancel(
    text({
      message: "Agent Name",
      initialValue: currentConfig.agentName,
      validate: (value) => ((value ?? "").trim().length > 0 ? undefined : "Agent Name is required"),
    }),
    runtime,
  )) as string;

  const bio = (await guardCancel(
    text({
      message: "Agent Bio (Optional)",
      initialValue: currentConfig.bio,
    }),
    runtime,
  )) as string;

  outro(chalk.green(`✅ Moltbook configured for @${agentName}!`));

  return {
    ...nextConfig,
    moltbook: {
      enabled: true,
      apiKey: apiKey,
      agentName: agentName,
      bio: bio || undefined,
    },
  };
}
