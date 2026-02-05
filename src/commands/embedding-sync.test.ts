import { describe, expect, it } from "vitest";
import type { VersoConfig } from "../config/config.js";
import { syncEmbeddingProviderWithModel } from "./auth-choice.default-model.js";

describe("syncEmbeddingProviderWithModel", () => {
  it("should sync embedding for google model", () => {
    const config: VersoConfig = { agents: { defaults: { memorySearch: { provider: "openai" } } } };
    const result = syncEmbeddingProviderWithModel(config, "google/gemini-pro");
    expect(result.agents?.defaults?.memorySearch?.provider).toBe("gemini");
    expect(result.agents?.defaults?.memorySearch?.remote).toBeUndefined();
  });

  it("should sync embedding for openai model", () => {
    const config: VersoConfig = { agents: { defaults: { memorySearch: { provider: "gemini" } } } };
    const result = syncEmbeddingProviderWithModel(config, "openai/gpt-4");
    expect(result.agents?.defaults?.memorySearch?.provider).toBe("openai");
    expect(result.agents?.defaults?.memorySearch?.remote).toBeUndefined();
  });

  it("should sync embedding for custom-openai model", () => {
    const config: VersoConfig = {
      models: {
        providers: {
          "custom-openai": {
            baseUrl: "https://my-custom-api.com/v1",
            apiKey: "sk-custom-key",
            models: [],
          },
        },
      },
      agents: { defaults: { memorySearch: { provider: "gemini" } } },
    };
    const result = syncEmbeddingProviderWithModel(config, "custom-openai/my-model");
    expect(result.agents?.defaults?.memorySearch?.provider).toBe("openai");
    expect(result.agents?.defaults?.memorySearch?.enabled).toBe(true);
    expect(result.agents?.defaults?.memorySearch?.remote).toEqual({
      baseUrl: "https://my-custom-api.com/v1",
      apiKey: "sk-custom-key",
    });
  });

  it("should NOT sync for anthropic (unsupported provider)", () => {
    const config: VersoConfig = { agents: { defaults: { memorySearch: { provider: "openai" } } } };
    const result = syncEmbeddingProviderWithModel(config, "anthropic/claude-3-opus");
    expect(result.agents?.defaults?.memorySearch?.provider).toBe("openai");
  });

  it("should clear remote config when switching back to standard provider", () => {
    const config: VersoConfig = {
      agents: {
        defaults: {
          memorySearch: {
            provider: "openai",
            remote: { baseUrl: "http://old-url" },
          },
        },
      },
    };
    const result = syncEmbeddingProviderWithModel(config, "openai/gpt-4");
    expect(result.agents?.defaults?.memorySearch?.provider).toBe("openai");
    expect(result.agents?.defaults?.memorySearch?.remote).toBeUndefined();
  });
});

import { normalizeOpenAiModel } from "../memory/embeddings-openai.js";

describe("normalizeOpenAiModel", () => {
  it("should strip custom-openai/ prefix", () => {
    expect(normalizeOpenAiModel("custom-openai/my-model")).toBe("my-model");
  });
  it("should strip openai/ prefix", () => {
    expect(normalizeOpenAiModel("openai/gpt-4")).toBe("gpt-4");
  });
  it("should return clean model name as is", () => {
    expect(normalizeOpenAiModel("gpt-4")).toBe("gpt-4");
  });
});
