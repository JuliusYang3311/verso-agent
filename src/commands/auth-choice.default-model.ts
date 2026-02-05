import { DEFAULT_PROVIDER } from "../agents/defaults.js";
import { parseModelRef } from "../agents/model-selection.js";
import type { VersoConfig } from "../config/config.js";
import type { WizardPrompter } from "../wizard/prompts.js";

const SUPPORTED_EMBEDDING_PROVIDERS = new Set(["openai", "gemini", "google"]);

function normalizeEmbeddingProvider(provider: string): "openai" | "gemini" | undefined {
  if (provider === "openai") return "openai";
  if (provider === "gemini") return "gemini";
  if (provider === "google") return "gemini";
  return undefined;
}

export function syncEmbeddingProviderWithModel(config: VersoConfig, model: string): VersoConfig {
  const parsed = parseModelRef(model, DEFAULT_PROVIDER);
  if (!parsed) return config;

  if (parsed.provider === "custom-openai") {
    const providerConfig = config.models?.providers?.[parsed.provider];
    if (providerConfig) {
      return {
        ...config,
        agents: {
          ...config.agents,
          defaults: {
            ...config.agents?.defaults,
            memorySearch: {
              ...config.agents?.defaults?.memorySearch,
              provider: "openai",
              enabled: true,
              remote: {
                baseUrl: providerConfig.baseUrl,
                apiKey: providerConfig.apiKey,
              },
            },
          },
        },
      };
    }
  }

  const embeddingProvider = normalizeEmbeddingProvider(parsed.provider);
  if (!embeddingProvider) return config;

  // Clear remote config if switching to a standard provider to avoid stale custom settings
  return {
    ...config,
    agents: {
      ...config.agents,
      defaults: {
        ...config.agents?.defaults,
        memorySearch: {
          ...config.agents?.defaults?.memorySearch,
          provider: embeddingProvider,
          remote: undefined,
        },
      },
    },
  };
}

export async function applyDefaultModelChoice(params: {
  config: VersoConfig;
  setDefaultModel: boolean;
  defaultModel: string;
  applyDefaultConfig: (config: VersoConfig) => VersoConfig;
  applyProviderConfig: (config: VersoConfig) => VersoConfig;
  noteDefault?: string;
  noteAgentModel: (model: string) => Promise<void>;
  prompter: WizardPrompter;
}): Promise<{ config: VersoConfig; agentModelOverride?: string }> {
  if (params.setDefaultModel) {
    let next = params.applyDefaultConfig(params.config);

    // Auto-sync embedding provider if the new default model's provider supports it.
    next = syncEmbeddingProviderWithModel(next, params.defaultModel);

    // If we switched to Gemini, ensure the vector store implementation is compatible if needed
    // (though usually 'gemini' provider just works with the default store).

    if (params.noteDefault) {
      await params.prompter.note(`Default model set to ${params.noteDefault}`, "Model configured");
    }
    return { config: next };
  }

  const next = params.applyProviderConfig(params.config);
  await params.noteAgentModel(params.defaultModel);
  return { config: next, agentModelOverride: params.defaultModel };
}
