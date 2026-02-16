import { confirm, isCancel } from "@clack/prompts";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  checkShellCompletionStatus,
  ensureCompletionCacheExists,
} from "../commands/doctor-completion.js";
import { defaultRuntime } from "../runtime.js";
import { stylePromptMessage } from "../terminal/prompt-style.js";
import { theme } from "../terminal/theme.js";
import { replaceCliName, resolveCliName } from "./cli-name.js";
import { formatCliCommand } from "./command-format.js";
import { installCompletion } from "./completion-cli.js";
import { pathExists, resolveNodeRunner } from "./update-helpers.js";

const CLI_NAME = resolveCliName();

export async function tryWriteCompletionCache(root: string, jsonMode: boolean): Promise<void> {
  const binPath = path.join(root, "openclaw.mjs");
  if (!(await pathExists(binPath))) {
    return;
  }
  const result = spawnSync(resolveNodeRunner(), [binPath, "completion", "--write-state"], {
    cwd: root,
    env: process.env,
    encoding: "utf-8",
  });
  if (result.error) {
    if (!jsonMode) {
      defaultRuntime.log(theme.warn(`Completion cache update failed: ${String(result.error)}`));
    }
    return;
  }
  if (result.status !== 0 && !jsonMode) {
    const stderr = (result.stderr ?? "").toString().trim();
    const detail = stderr ? ` (${stderr})` : "";
    defaultRuntime.log(theme.warn(`Completion cache update failed${detail}.`));
  }
}

/** Check if shell completion is installed and prompt user to install if not. */
export async function tryInstallShellCompletion(opts: {
  jsonMode: boolean;
  skipPrompt: boolean;
}): Promise<void> {
  if (opts.jsonMode || !process.stdin.isTTY) {
    return;
  }

  const status = await checkShellCompletionStatus(CLI_NAME);

  // Profile uses slow dynamic pattern - upgrade to cached version
  if (status.usesSlowPattern) {
    defaultRuntime.log(theme.muted("Upgrading shell completion to cached version..."));
    // Ensure cache exists first
    const cacheGenerated = await ensureCompletionCacheExists(CLI_NAME);
    if (cacheGenerated) {
      await installCompletion(status.shell, true, CLI_NAME);
    }
    return;
  }

  // Profile has completion but no cache - auto-fix silently
  if (status.profileInstalled && !status.cacheExists) {
    defaultRuntime.log(theme.muted("Regenerating shell completion cache..."));
    await ensureCompletionCacheExists(CLI_NAME);
    return;
  }

  // No completion at all - prompt to install
  if (!status.profileInstalled) {
    defaultRuntime.log("");
    defaultRuntime.log(theme.heading("Shell completion"));

    const shouldInstall = await confirm({
      message: stylePromptMessage(`Enable ${status.shell} shell completion for ${CLI_NAME}?`),
      initialValue: true,
    });

    if (isCancel(shouldInstall) || !shouldInstall) {
      if (!opts.skipPrompt) {
        defaultRuntime.log(
          theme.muted(
            `Skipped. Run \`${replaceCliName(formatCliCommand("verso completion --install"), CLI_NAME)}\` later to enable.`,
          ),
        );
      }
      return;
    }

    // Generate cache first (required for fast shell startup)
    const cacheGenerated = await ensureCompletionCacheExists(CLI_NAME);
    if (!cacheGenerated) {
      defaultRuntime.log(theme.warn("Failed to generate completion cache."));
      return;
    }

    await installCompletion(status.shell, opts.skipPrompt, CLI_NAME);
  }
}
