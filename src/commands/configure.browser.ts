/**
 * Browser configuration prompts.
 * Configures the headless browser and snapshot capabilities.
 */

import type { VersoConfig } from "../config/config.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { note } from "../terminal/note.js";
import { confirm, select } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";

const DEFAULT_BROWSER_ENABLED = false;
const DEFAULT_HEADLESS = true;

/**
 * Prompt user for browser configuration.
 */
export async function promptBrowserConfig(
  cfg: VersoConfig,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<VersoConfig> {
  const existingBrowser = cfg.browser;

  note(
    [
      "Browser capabilities allow the agent to:",
      "• Browse websites and read content",
      "• Take screenshots and snapshots of pages",
      "• Interact with web applications",
      "",
      "This uses a local Chrome/Chromium instance (headless by default).",
    ].join("\n"),
    "Browser & Snapshots",
  );

  // 1. Enable Browser
  const enableBrowser = guardCancel(
    await confirm({
      message: "Enable Browser capabilities?",
      initialValue: existingBrowser?.enabled ?? DEFAULT_BROWSER_ENABLED,
    }),
    runtime,
  );

  if (!enableBrowser) {
    return {
      ...cfg,
      browser: {
        ...existingBrowser,
        enabled: false,
      },
    };
  }

  // 2. Headless Mode
  const mode = guardCancel(
    await select({
      message: "Browser Mode",
      options: [
        {
          value: "headless",
          label: "Headless (Background)",
          hint: "Invisible, faster, best for server/background tasks",
        },
        {
          value: "headed",
          label: "Headed (Visible)",
          hint: "Visible window, good for debugging or watching the agent",
        },
      ],
      initialValue: (existingBrowser?.headless ?? DEFAULT_HEADLESS) ? "headless" : "headed",
    }),
    runtime,
  );

  const headless = mode === "headless";

  // 3. Snapshot Defaults (Optional - can stick to defaults for now, but good to mention)
  // We can add more detailed config later if needed.

  runtime.log(`Browser enabled (${headless ? "headless" : "visible"}).`);

  return {
    ...cfg,
    browser: {
      ...existingBrowser,
      enabled: true,
      headless,
    },
  };
}
