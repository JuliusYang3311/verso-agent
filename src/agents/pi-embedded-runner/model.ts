import type { Api, Model } from "@mariozechner/pi-ai";
import type { VersoConfig } from "../../config/config.js";
import type { ModelDefinitionConfig } from "../../config/types.js";
import { resolveVersoAgentDir } from "../agent-paths.js";
import { DEFAULT_CONTEXT_TOKENS } from "../defaults.js";
import { normalizeModelCompat } from "../model-compat.js";
import { normalizeProviderId } from "../model-selection.js";
import {
  discoverAuthStorage,
  discoverModels,
  type AuthStorage,
  type ModelRegistry,
} from "../pi-model-discovery.js";

type InlineModelEntry = ModelDefinitionConfig & { provider: string; baseUrl?: string };
type InlineProviderConfig = {
  baseUrl?: string;
  api?: ModelDefinitionConfig["api"];
  models?: ModelDefinitionConfig[];
};

const OPENAI_CODEX_GPT_53_MODEL_ID = "gpt-5.3-codex";

const OPENAI_CODEX_TEMPLATE_MODEL_IDS = ["gpt-5.2-codex"] as const;

// pi-ai's built-in Anthropic catalog can lag behind Verso's defaults/docs.
// Add forward-compat fallbacks for known-new IDs by cloning an older template model.
const ANTHROPIC_OPUS_46_MODEL_ID = "claude-opus-4-6";
const ANTHROPIC_OPUS_46_DOT_MODEL_ID = "claude-opus-4.6";
const ANTHROPIC_OPUS_TEMPLATE_MODEL_IDS = ["claude-opus-4-5", "claude-opus-4.5"] as const;

function resolveOpenAICodexGpt53FallbackModel(
  provider: string,
  modelId: string,
  modelRegistry: ModelRegistry,
): Model<Api> | undefined {
  const normalizedProvider = normalizeProviderId(provider);
  const trimmedModelId = modelId.trim();
  if (normalizedProvider !== "openai-codex") {
    return undefined;
  }
  if (trimmedModelId.toLowerCase() !== OPENAI_CODEX_GPT_53_MODEL_ID) {
    return undefined;
  }

  for (const templateId of OPENAI_CODEX_TEMPLATE_MODEL_IDS) {
    const template = modelRegistry.find(normalizedProvider, templateId) as Model<Api> | null;
    if (!template) {
      continue;
    }
    return normalizeModelCompat({
      ...template,
      id: trimmedModelId,
      name: trimmedModelId,
    } as Model<Api>);
  }

  return normalizeModelCompat({
    id: trimmedModelId,
    name: trimmedModelId,
    api: "openai-codex-responses",
    provider: normalizedProvider,
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_TOKENS,
    maxTokens: DEFAULT_CONTEXT_TOKENS,
  } as Model<Api>);
}

function resolveAnthropicOpus46ForwardCompatModel(
  provider: string,
  modelId: string,
  modelRegistry: ModelRegistry,
): Model<Api> | undefined {
  const normalizedProvider = normalizeProviderId(provider);
  // Support both native anthropic and google-antigravity (which routes Anthropic models)
  const isAnthropicCompatible =
    normalizedProvider === "anthropic" || normalizedProvider === "google-antigravity";
  if (!isAnthropicCompatible) {
    return undefined;
  }

  const trimmedModelId = modelId.trim();
  const lower = trimmedModelId.toLowerCase();
  const isOpus46 =
    lower === ANTHROPIC_OPUS_46_MODEL_ID ||
    lower === ANTHROPIC_OPUS_46_DOT_MODEL_ID ||
    lower.startsWith(`${ANTHROPIC_OPUS_46_MODEL_ID}-`) ||
    lower.startsWith(`${ANTHROPIC_OPUS_46_DOT_MODEL_ID}-`);
  if (!isOpus46) {
    return undefined;
  }

  const templateIds: string[] = [];
  if (lower.startsWith(ANTHROPIC_OPUS_46_MODEL_ID)) {
    templateIds.push(lower.replace(ANTHROPIC_OPUS_46_MODEL_ID, "claude-opus-4-5"));
  }
  if (lower.startsWith(ANTHROPIC_OPUS_46_DOT_MODEL_ID)) {
    templateIds.push(lower.replace(ANTHROPIC_OPUS_46_DOT_MODEL_ID, "claude-opus-4.5"));
  }
  templateIds.push(...ANTHROPIC_OPUS_TEMPLATE_MODEL_IDS);

  // For google-antigravity, try looking up templates under both the actual provider
  // and under "anthropic" (where the base model definitions live)
  const lookupProviders =
    normalizedProvider === "google-antigravity"
      ? [normalizedProvider, "anthropic"]
      : [normalizedProvider];

  for (const lookupProvider of lookupProviders) {
    for (const templateId of [...new Set(templateIds)].filter(Boolean)) {
      const template = modelRegistry.find(lookupProvider, templateId) as Model<Api> | null;
      if (!template) {
        continue;
      }
      return normalizeModelCompat({
        ...template,
        id: trimmedModelId,
        name: trimmedModelId,
        provider: normalizedProvider,
      } as Model<Api>);
    }
  }

  return undefined;
}

export function buildInlineProviderModels(
  providers: Record<string, InlineProviderConfig>,
): InlineModelEntry[] {
  return Object.entries(providers).flatMap(([providerId, entry]) => {
    const trimmed = providerId.trim();
    if (!trimmed) {
      return [];
    }
    const resolveDefaultApi = (p: string) => {
      switch (p) {
        case "anthropic":
          return "anthropic-messages";
        case "google":
          return "google-generative-ai";
        case "bedrock":
          return "bedrock-converse-stream";
        case "copilot":
          return "github-copilot";
        default:
          return "openai-responses";
      }
    };

    return (entry?.models ?? []).map((model) => ({
      ...model,
      provider: trimmed,
      baseUrl: entry?.baseUrl,
      // FIX: Default to provider-specific API type or "openai-responses" if API is not specified.
      // This prevents "Unhandled API" crashes while respecting known provider protocols.
      api: model.api ?? entry?.api ?? resolveDefaultApi(trimmed),
    }));
  });
}

export function buildModelAliasLines(cfg?: VersoConfig) {
  const models = cfg?.agents?.defaults?.models ?? {};
  const entries: Array<{ alias: string; model: string }> = [];
  for (const [keyRaw, entryRaw] of Object.entries(models)) {
    const model = String(keyRaw ?? "").trim();
    if (!model) {
      continue;
    }
    const alias = String((entryRaw as { alias?: string } | undefined)?.alias ?? "").trim();
    if (!alias) {
      continue;
    }
    entries.push({ alias, model });
  }
  return entries
    .toSorted((a, b) => a.alias.localeCompare(b.alias))
    .map((entry) => `- ${entry.alias}: ${entry.model}`);
}

export function resolveModel(
  provider: string,
  modelId: string,
  agentDir?: string,
  cfg?: VersoConfig,
): {
  model?: Model<Api>;
  error?: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
} {
  const resolvedAgentDir = agentDir ?? resolveVersoAgentDir();
  const authStorage = discoverAuthStorage(resolvedAgentDir);
  const modelRegistry = discoverModels(authStorage, resolvedAgentDir);

  // Fix: If modelId incorrectly includes the provider prefix (e.g. "custom-openai/my-model"),
  // strip it so we look up "my-model" instead. This ensures API calls use the clean ID.
  // This happens if the caller passes the full key as the model ID.
  // STRICT CHECK: Only apply this to custom-openai (enforced by config wizard) and ollama.
  if (provider === "custom-openai" || provider === "ollama") {
    const prefix = `${provider}/`;
    if (modelId.startsWith(prefix)) {
      modelId = modelId.slice(prefix.length);
    }
  }

  // 1. Try to find in registry (built-in or dynamic providers)
  let rawModel: Model<Api> | null = modelRegistry.find(provider, modelId) as Model<Api> | null;
  const providers = cfg?.models?.providers ?? {};

  if (!rawModel) {
    // 2. Try to find in custom inline providers
    const inlineModels = buildInlineProviderModels(providers);
    const normalizedProvider = normalizeProviderId(provider);
    const inlineMatch = inlineModels.find(
      (entry) => normalizeProviderId(entry.provider) === normalizedProvider && entry.id === modelId,
    );

    if (inlineMatch) {
      rawModel = normalizeModelCompat(inlineMatch as Model<Api>);
    } else {
      // 3. Fallback logic for generic providers or mocks
      const providerCfg = providers[provider];
      if (providerCfg || modelId.startsWith("mock-")) {
        rawModel = normalizeModelCompat({
          id: modelId,
          name: modelId,
          api: providerCfg?.api ?? "openai-responses",
          provider,
          baseUrl: providerCfg?.baseUrl,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: providerCfg?.models?.[0]?.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
          maxTokens: providerCfg?.models?.[0]?.maxTokens ?? DEFAULT_CONTEXT_TOKENS,
        } as Model<Api>);
      }
    }
  }

  // 4. Forward-compat fallbacks for known-new model IDs
  if (!rawModel) {
    rawModel =
      resolveAnthropicOpus46ForwardCompatModel(provider, modelId, modelRegistry) ??
      resolveOpenAICodexGpt53FallbackModel(provider, modelId, modelRegistry) ??
      null;
  }

  if (rawModel) {
    // Apply effective context window logic: min(model.contextWindow, global.contextTokens)
    // Clone to avoid mutating shared registry objects if they are cached
    const finalModel = { ...rawModel };

    const globalContextLimit = cfg?.agents?.defaults?.contextTokens;
    if (globalContextLimit !== undefined && globalContextLimit < finalModel.contextWindow) {
      finalModel.contextWindow = globalContextLimit;
    }
    return { model: normalizeModelCompat(finalModel), authStorage, modelRegistry };
  }

  return {
    error: `Unknown model: ${provider}/${modelId}`,
    authStorage,
    modelRegistry,
  };
}
