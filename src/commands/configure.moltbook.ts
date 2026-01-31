import chalk from "chalk";
import { updateVersoConfig } from "../config/manage.js";
import { getVersoConfig } from "../config/get.js";
import type { ConfigureContext } from "./configure.types.js";
import { confirm, text, intro, outro } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";
import { defaultRuntime } from "../runtime.js";

export async function configureMoltbook(ctx: ConfigureContext) {
  intro(chalk.bold("🦞 Moltbook Configuration"));

  const currentConfig = getVersoConfig().moltbook || {};
  const runtime = defaultRuntime;

  const enabled = guardCancel(
    await confirm({
      message: "Enable Moltbook skills?",
      initialValue: currentConfig.enabled ?? true,
    }),
    runtime,
  );

  if (!enabled) {
    await updateVersoConfig({
      moltbook: {
        ...currentConfig,
        enabled: false,
      },
    });
    outro(chalk.gray("Moltbook disabled."));
    return;
  }

  const apiKey = guardCancel(
    await text({
      message: "Moltbook API Key",
      placeholder: "moltbook_...",
      initialValue: currentConfig.apiKey,
      validate: (value) => (value.trim().length > 0 ? undefined : "API Key is required"),
    }),
    runtime,
  );

  const agentName = guardCancel(
    await text({
      message: "Agent Name",
      initialValue: currentConfig.agentName,
      validate: (value) => (value.trim().length > 0 ? undefined : "Agent Name is required"),
    }),
    runtime,
  );

  const bio = guardCancel(
    await text({
      message: "Agent Bio (Optional)",
      initialValue: currentConfig.bio,
    }),
    runtime,
  );

  await updateVersoConfig({
    moltbook: {
      enabled: true,
      apiKey: String(apiKey),
      agentName: String(agentName),
      bio: String(bio || ""),
    },
  });

  outro(chalk.green(`✅ Moltbook configured for @${agentName}!`));
}
