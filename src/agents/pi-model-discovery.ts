import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import path from "node:path";

export { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

import type { Api, Model } from "@mariozechner/pi-ai";

// Compatibility helpers for pi-coding-agent 0.50+ (discover* helpers removed).
export function discoverAuthStorage(agentDir: string): AuthStorage {
  return new AuthStorage(path.join(agentDir, "auth.json"));
}

const OVERRIDES: Model<Api>[] = [];

export function discoverModels(authStorage: AuthStorage, agentDir: string): ModelRegistry {
  const registry = new ModelRegistry(authStorage, path.join(agentDir, "models.json"));
  const originalFind = registry.find.bind(registry);

  registry.find = (provider: string, modelId: string): Model<Api> | undefined => {
    // 1. Delegate to standard registry lookup first
    const original = originalFind(provider, modelId);

    // 2. If found, apply specific patches for high-context models
    if (original) {
      if (modelId === "gemini-3-flash-preview") {
        return {
          ...original,
          contextWindow: 1048576, // 1M
        };
      }
      if (modelId === "gemini-3-pro-preview") {
        return {
          ...original,
          contextWindow: 1048576, // 1M
          reasoning: true,
        };
      }
      if (modelId === "gpt-5.3" || modelId === "gpt-5.3-codex") {
        return {
          ...original,
          contextWindow: 1048576,
        };
      }
      if (modelId === "claude-opus-4-6") {
        return {
          ...original,
          contextWindow: 1048576,
        };
      }
      return original;
    }

    // 3. Fallback: If standard lookup fails, we assume it's a new model not yet in registry
    // and provide a minimal valid definition based on the provider.
    // This is less risky than a full static override list because we only do it when necessary.
    if (modelId === "gemini-3-flash-preview" || modelId === "gemini-3-pro-preview") {
      // Only provide fallback if we are sure about the provider structure
      if (provider === "google-gemini-cli") {
        return {
          id: modelId,
          name:
            modelId === "gemini-3-pro-preview"
              ? "Gemini 3 Pro (Preview)"
              : "Gemini 3 Flash (Preview)",
          provider: "google-gemini-cli",
          api: "google-gemini-cli", // Correct API type for CLI for OAuth
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          reasoning: modelId === "gemini-3-pro-preview",
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1048576,
          maxTokens: 65536,
        };
      }
      // Determine API type for standard provider
      const isGoogle = provider === "google";
      return {
        id: modelId,
        name:
          modelId === "gemini-3-pro-preview"
            ? "Gemini 3 Pro (Preview)"
            : "Gemini 3 Flash (Preview)",
        provider: provider,
        api: isGoogle ? "google-generative-ai" : "google-gemini-cli",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        reasoning: modelId === "gemini-3-pro-preview",
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1048576,
        maxTokens: 65536,
      };
    }

    return undefined;
  };

  return registry;
}
