import type { VersoConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { select } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";

export async function promptEvolverConfig(
  nextConfig: VersoConfig,
  _runtime: RuntimeEnv,
): Promise<VersoConfig> {
  const existing = nextConfig.evolver ?? {};

  const review = guardCancel(
    await select({
      message: "Evolver review mode",
      options: [
        { value: true, label: "Enable", hint: "Require review before deploying changes" },
        { value: false, label: "Disable", hint: "Auto-deploy after validation passes" },
      ],
      initialValue: existing.review ?? false,
    }),
    _runtime,
  );

  return {
    ...nextConfig,
    evolver: {
      review,
    },
  };
}
