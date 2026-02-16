import type { VersoConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { resolveUserPath } from "../utils.js";
import { confirm, select, text } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";

const DEFAULT_EVOLVER_DIR = "/Users/veso/Documents/verso/skills/evolver-1.10.0";

export async function promptEvolverConfig(
  nextConfig: VersoConfig,
  runtime: RuntimeEnv,
): Promise<VersoConfig> {
  const existing = nextConfig.evolver ?? {};
  const defaultWorkspace = nextConfig.agents?.defaults?.workspace ?? "/Users/veso/Documents/verso";
  const dirInput = guardCancel(
    await text({
      message: "Evolver directory",
      initialValue: existing.dir ?? DEFAULT_EVOLVER_DIR,
    }),
    runtime,
  );
  const dir = resolveUserPath(String(dirInput ?? "").trim() || DEFAULT_EVOLVER_DIR);

  const workspaceInput = guardCancel(
    await text({
      message: "Verso workspace (skills/memory root)",
      initialValue: existing.workspace ?? defaultWorkspace,
    }),
    runtime,
  );
  const workspace = resolveUserPath(String(workspaceInput ?? "").trim() || defaultWorkspace);

  const review = guardCancel(
    await select({
      message: "Evolver review mode",
      options: [
        { value: true, label: "Enable", hint: "Run with --review" },
        { value: false, label: "Disable", hint: "Run directly" },
      ],
      initialValue: existing.review ?? false,
    }),
    runtime,
  );

  const verifyCmdInput = guardCancel(
    await text({
      message: "Verify command",
      initialValue: existing.verifyCmd ?? "pnpm build",
    }),
    runtime,
  );
  const verifyCmd = String(verifyCmdInput ?? "").trim() || "pnpm build";

  const rollback = guardCancel(
    await confirm({
      message: "Enable rollback on failure?",
      initialValue: existing.rollback ?? true,
    }),
    runtime,
  );

  const clean = guardCancel(
    await confirm({
      message: "Allow git clean -fd during rollback?",
      initialValue: existing.clean ?? true,
    }),
    runtime,
  );

  return {
    ...nextConfig,
    agents: {
      ...nextConfig.agents,
      defaults: {
        ...nextConfig.agents?.defaults,
        workspace,
      },
    },
    evolver: {
      dir,
      workspace,
      review,
      verifyCmd,
      rollback,
      clean,
    },
  };
}
