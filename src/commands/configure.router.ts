/**
 * Router configuration wizard component.
 * Prompts user to configure smart model routing settings.
 */

import type { VersoConfig } from "../config/config.js";
import type { RouterConfig } from "../config/types.router.js";
import { confirm, text } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { note } from "../terminal/note.js";

const DEFAULT_CLASSIFIER_MODEL = "google/gemini-2.5-pro";

const TASK_TYPE_OPTIONS = [
  { value: "coding", label: "Coding", hint: "Programming, debugging, code review" },
  { value: "writing", label: "Writing", hint: "Creative writing, essays, documentation" },
  { value: "analysis", label: "Analysis", hint: "Data analysis, research, summarization" },
  { value: "reasoning", label: "Reasoning", hint: "Math, logic, problem-solving" },
  { value: "creative", label: "Creative", hint: "Brainstorming, design, artistic content" },
  { value: "chat", label: "Chat", hint: "General conversation, simple questions" },
] as const;

/**
 * Prompt user for router configuration.
 */
export async function promptRouterConfig(
  cfg: VersoConfig,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<VersoConfig> {
  const existingRouter = cfg.agents?.defaults?.router;

  note(
    [
      "Smart Router automatically selects the best model for each task.",
      "",
      "• Classifier: A fast model that analyzes your message",
      "• Task Models: Map task types (coding, writing, etc.) to specific models",
      "• Fallback: Uses Primary Model if no specific task model matches",
      "",
      "Example: Use Claude Sonnet for coding, Gemini for general chat",
    ].join("\n"),
    "Smart Model Router",
  );

  // Ask if user wants to enable router
  const enableRouter = guardCancel(
    await confirm({
      message: "Enable smart model routing?",
      initialValue: existingRouter?.enabled ?? false,
    }),
    runtime,
  );

  if (!enableRouter) {
    // Disable router
    return {
      ...cfg,
      agents: {
        ...cfg.agents,
        defaults: {
          ...cfg.agents?.defaults,
          router: {
            ...existingRouter,
            enabled: false,
          },
        },
      },
    };
  }

  // Get classifier model
  const classifierModel = guardCancel(
    await text({
      message: "Classifier model (fast model recommended)",
      initialValue: existingRouter?.classifierModel ?? DEFAULT_CLASSIFIER_MODEL,
      placeholder: DEFAULT_CLASSIFIER_MODEL,
    }),
    runtime,
  );

  const enableThinking = guardCancel(
    await confirm({
      message: "Enable thinking for classifier? (Improves accuracy, slightly slower)",
      initialValue: existingRouter?.thinking ?? false,
    }),
    runtime,
  );

  const routerConfig: RouterConfig = {
    enabled: true,
    classifierModel: String(classifierModel) || DEFAULT_CLASSIFIER_MODEL,
    thinking: enableThinking,
  };

  runtime.log(`Router enabled for dynamic model selection`);

  // Ask for Global Default/Fallback Model
  // (Used when router is disabled, fails, or returns no result)
  const existingDefault = (() => {
    const m = cfg.agents?.defaults?.model;
    if (typeof m === "string") return m;
    return m?.primary;
  })();

  const defaultModel = guardCancel(
    await text({
      message: "Primary Model (used as default and router fallback)",
      initialValue: existingDefault ?? "anthropic/claude-3-7-sonnet",
      placeholder: "provider/model",
    }),
    runtime,
  );

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        model: {
          ...(typeof cfg.agents?.defaults?.model === "object" ? cfg.agents.defaults.model : {}),
          primary: String(defaultModel).trim(),
        },
        router: routerConfig,
      },
    },
  };
}
