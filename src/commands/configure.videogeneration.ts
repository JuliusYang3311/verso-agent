import type { VersoConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { confirm, text } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";

export async function promptVideoGenerationConfig(
  nextConfig: VersoConfig,
  runtime: RuntimeEnv,
): Promise<VersoConfig> {
  const existing = nextConfig.videoGeneration;

  const enabled = (await guardCancel(
    confirm({
      message: "Enable Video Generation skill?",
      initialValue: existing?.enabled ?? false,
    }),
    runtime,
  )) as boolean;

  if (!enabled) {
    return {
      ...nextConfig,
      videoGeneration: { ...existing, enabled: false },
    };
  }

  const pexelsApiKey = (await guardCancel(
    text({
      message: "Pexels API Key (for stock videos)",
      placeholder: "Get from pexels.com/api",
      initialValue: existing?.pexelsApiKey || "",
    }),
    runtime,
  )) as string;

  const pixabayApiKey = (await guardCancel(
    text({
      message: "Pixabay API Key (optional backup source)",
      placeholder: "Get from pixabay.com/api/docs",
      initialValue: existing?.pixabayApiKey || "",
    }),
    runtime,
  )) as string;

  const outputPath = (await guardCancel(
    text({
      message: "Output directory for generated videos",
      placeholder: "~/Projects/tmp",
      initialValue: existing?.outputPath || "~/Projects/tmp",
    }),
    runtime,
  )) as string;

  return {
    ...nextConfig,
    videoGeneration: {
      enabled,
      pexelsApiKey: pexelsApiKey || undefined,
      pixabayApiKey: pixabayApiKey || undefined,
      outputPath: outputPath || undefined,
      retentionDays: existing?.retentionDays ?? 7,
    },
  };
}
