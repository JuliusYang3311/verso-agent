import type { VersoConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { confirm, text } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";

export async function promptTwitterConfig(
  nextConfig: VersoConfig,
  runtime: RuntimeEnv,
): Promise<VersoConfig> {
  const existing = nextConfig.twitter;

  const enabled = (await guardCancel(
    confirm({
      message: "Enable Twitter skill/integration?",
      initialValue: existing?.enabled ?? false,
    }),
    runtime,
  )) as boolean;

  if (!enabled) {
    return {
      ...nextConfig,
      twitter: { ...existing, enabled: false },
    };
  }

  const apiKey = (await guardCancel(
    text({
      message: "Twitter API Key (Consumer Key)",
      initialValue: existing?.apiKey || "",
    }),
    runtime,
  )) as string;

  const apiSecret = (await guardCancel(
    text({
      message: "Twitter API Secret (Consumer Secret)",
      initialValue: existing?.apiSecret || "",
    }),
    runtime,
  )) as string;

  const accessToken = (await guardCancel(
    text({
      message: "Twitter Access Token",
      initialValue: existing?.accessToken || "",
    }),
    runtime,
  )) as string;

  const accessSecret = (await guardCancel(
    text({
      message: "Twitter Access Secret",
      initialValue: existing?.accessSecret || "",
    }),
    runtime,
  )) as string;

  return {
    ...nextConfig,
    twitter: {
      enabled,
      apiKey: apiKey || undefined,
      apiSecret: apiSecret || undefined,
      accessToken: accessToken || undefined,
      accessSecret: accessSecret || undefined,
    },
    skills: {
      ...nextConfig.skills,
      entries: {
        ...nextConfig.skills?.entries,
        twitter: {
          ...nextConfig.skills?.entries?.["twitter"],
          env: {
            TWITTER_API_KEY: apiKey || "",
            TWITTER_API_SECRET: apiSecret || "",
            TWITTER_ACCESS_TOKEN: accessToken || "",
            TWITTER_ACCESS_SECRET: accessSecret || "",
          },
        },
      },
    },
  };
}
