import type { VersoConfig } from "../config/config.js";
import type { MemorySearchConfig } from "../config/types.tools.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import type { AuthChoice } from "./onboard-types.js";
import { applyAuthChoiceAnthropic } from "./auth-choice.apply.anthropic.js";
import { applyAuthChoiceApiProviders } from "./auth-choice.apply.api-providers.js";
import { applyAuthChoiceCopilotProxy } from "./auth-choice.apply.copilot-proxy.js";
import { applyAuthChoiceCustom } from "./auth-choice.apply.custom.js";
import { applyAuthChoiceGitHubCopilot } from "./auth-choice.apply.github-copilot.js";
import { applyAuthChoiceGoogleAntigravity } from "./auth-choice.apply.google-antigravity.js";
import { applyAuthChoiceGoogleGeminiCli } from "./auth-choice.apply.google-gemini-cli.js";
import { applyAuthChoiceMiniMax } from "./auth-choice.apply.minimax.js";
import { applyAuthChoiceOAuth } from "./auth-choice.apply.oauth.js";
import { applyAuthChoiceOpenAI } from "./auth-choice.apply.openai.js";
import { applyAuthChoiceQwenPortal } from "./auth-choice.apply.qwen-portal.js";
import { applyAuthChoiceXAI } from "./auth-choice.apply.xai.js";
import { resolvePreferredProviderForAuthChoice } from "./auth-choice.preferred-provider.js";
import { applyEmbeddingModel } from "./model-picker.js";

export type ApplyAuthChoiceParams = {
  authChoice: AuthChoice;
  config: VersoConfig;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
  agentDir?: string;
  setDefaultModel: boolean;
  agentId?: string;
  opts?: {
    tokenProvider?: string;
    token?: string;
    cloudflareAiGatewayAccountId?: string;
    cloudflareAiGatewayGatewayId?: string;
    cloudflareAiGatewayApiKey?: string;
    xaiApiKey?: string;
  };
};

export type ApplyAuthChoiceResult = {
  config: VersoConfig;
  agentModelOverride?: string;
};

export async function applyAuthChoice(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult> {
  const handlers: Array<(p: ApplyAuthChoiceParams) => Promise<ApplyAuthChoiceResult | null>> = [
    applyAuthChoiceAnthropic,
    applyAuthChoiceOpenAI,
    applyAuthChoiceOAuth,
    applyAuthChoiceApiProviders,
    applyAuthChoiceXAI,
    applyAuthChoiceMiniMax,
    applyAuthChoiceGitHubCopilot,
    applyAuthChoiceGoogleAntigravity,
    applyAuthChoiceGoogleGeminiCli,
    applyAuthChoiceCopilotProxy,
    applyAuthChoiceQwenPortal,
    applyAuthChoiceCustom,
  ];

  for (const handler of handlers) {
    const result = await handler(params);
    if (result) {
      // Synchronization: If they picked a native or local provider (Google/OpenAI/Anthropic/Local),
      // ensure memorySearch is also pointing to the native/local version if it was previously proxy-poisoned.
      const preferred = resolvePreferredProviderForAuthChoice(params.authChoice);
      if (
        preferred === "google" ||
        preferred === "openai" ||
        preferred === "anthropic" ||
        preferred === "local" ||
        preferred === "lmstudio"
      ) {
        const target =
          preferred === "google"
            ? "gemini"
            : ((preferred === "lmstudio" ? "local" : preferred) as MemorySearchConfig["provider"]);
        const current = result.config.agents?.defaults?.memorySearch;

        // If the embedding provider matches the main provider but is using a proxy,
        // OR if the embedding provider is different from the new main provider choice,
        // we offer a "synchronize" behavior by cleaning it up.
        if (current && current.provider === target && current.remote) {
          const model =
            target === "gemini"
              ? "gemini-embedding-001"
              : target === "local"
                ? "local"
                : "text-embedding-3-small";
          result.config = applyEmbeddingModel(result.config, {
            provider: target!,
            model: current.model || model,
            clearRemote: true,
          });
        }
      }
      return result;
    }
  }

  return { config: params.config };
}
