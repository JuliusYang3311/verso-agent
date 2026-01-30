import type { NodeHostConfig } from "../config/types.node-host.js";
import type { VersoConfig } from "../config/types.verso.js";
import type { RuntimeEnv } from "../runtime.js";
import { note } from "../terminal/note.js";
import { confirm } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";

export async function promptNodeHostConfig(
  nextConfig: VersoConfig,
  runtime: RuntimeEnv,
): Promise<VersoConfig> {
  const existing = nextConfig.nodeHost;

  note(
    [
      "Node Host settings control browser proxy for remote agent access.",
      "Browser proxy allows agents on remote nodes to control your local browser.",
      "This is needed for tools like 'browser' to work when running remotely.",
      "Docs: https://docs.molt.bot/features/browser",
    ].join("\n"),
    "Node Host (Browser Proxy)",
  );

  const enableBrowserProxy = guardCancel(
    await confirm({
      message: "Enable browser proxy for remote agents?",
      initialValue: existing?.browserProxy?.enabled ?? true,
    }),
    runtime,
  );

  const nextNodeHost: NodeHostConfig = {
    ...existing,
    browserProxy: {
      ...existing?.browserProxy,
      enabled: enableBrowserProxy,
    },
  };

  return {
    ...nextConfig,
    nodeHost: nextNodeHost,
  };
}
