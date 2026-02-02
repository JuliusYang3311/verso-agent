import type { VersoConfig } from "../config/config.js";
import { confirm, select } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { note } from "../terminal/note.js";

/**
 * Prompt user for thinking configuration.
 */
export async function promptThinkingConfig(
  cfg: VersoConfig,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<VersoConfig> {
  const existingThinking = cfg.agents?.defaults?.thinkingDefault;

  note(
    [
      "Thinking (Reasoning) allows the model to output its internal thought process.",
      "This helps with complex tasks like math, coding, and analysis.",
      "Higher levels produce more detailed reasoning but use more tokens.",
      "",
      "Note: Models must support thinking/reasoning for this to work.",
      "When enabled, reasoning visibility defaults to 'stream' (visible).",
    ].join("\n"),
    "Thinking / Reasoning",
  );

  const enableThinking = guardCancel(
    await confirm({
      message: "Enable thinking/reasoning by default?",
      initialValue: existingThinking && existingThinking !== "off",
    }),
    runtime,
  );

  if (!enableThinking) {
    return {
      ...cfg,
      agents: {
        ...cfg.agents,
        defaults: {
          ...cfg.agents?.defaults,
          thinkingDefault: "off",
        },
      },
    };
  }

  const thinkingLevel = guardCancel(
    await select({
      message: "Default thinking level",
      options: [
        { value: "low", label: "Low", hint: "Concise reasoning" },
        { value: "medium", label: "Medium", hint: "Standard reasoning" },
        { value: "high", label: "High", hint: "Detailed reasoning" },
        { value: "minimal", label: "Minimal", hint: "Very brief thoughts" },
      ],
      initialValue: existingThinking && existingThinking !== "off" ? existingThinking : "low",
    }),
    runtime,
  );

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        thinkingDefault: thinkingLevel as "low" | "medium" | "high" | "minimal",
      },
    },
  };
}
