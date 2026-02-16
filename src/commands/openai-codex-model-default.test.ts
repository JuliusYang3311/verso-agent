import { describe, expect, it } from "vitest";
import type { VersoConfig } from "../config/config.js";
import type { ModelProviderConfig } from "../config/types.models.js";
import {
  applyOpenAICodexModelDefault,
  OPENAI_CODEX_DEFAULT_MODEL,
} from "./openai-codex-model-default.js";

describe("applyOpenAICodexModelDefault", () => {
  it("sets openai-codex default when model is unset", () => {
    const cfg: VersoConfig = { agents: { defaults: {} } };
    const applied = applyOpenAICodexModelDefault(cfg);
    expect(applied.changed).toBe(true);
    expect(applied.next.agents?.defaults?.model).toEqual({
      primary: OPENAI_CODEX_DEFAULT_MODEL,
    });
    expect(applied.next.models?.providers?.["openai-codex"]).toBeDefined();
  });

  it("sets openai-codex default when model is openai/*", () => {
    const cfg: VersoConfig = {
      agents: { defaults: { model: "openai/gpt-5.2" } },
    };
    const applied = applyOpenAICodexModelDefault(cfg);
    expect(applied.changed).toBe(true);
    expect(applied.next.agents?.defaults?.model).toEqual({
      primary: OPENAI_CODEX_DEFAULT_MODEL,
    });
  });

  it("does not override openai-codex/*", () => {
    const cfg: VersoConfig = {
      agents: { defaults: { model: "openai-codex/gpt-5.2" } },
      models: {
        providers: { "openai-codex": {} as Partial<ModelProviderConfig> as ModelProviderConfig },
      },
    };
    const applied = applyOpenAICodexModelDefault(cfg);
    expect(applied.changed).toBe(false);
    expect(applied.next).toEqual(cfg);
  });

  it("NOW overrides non-openai models (e.g. anthropic)", () => {
    const cfg: VersoConfig = {
      agents: { defaults: { model: "anthropic/claude-opus-4-5" } },
    };
    const applied = applyOpenAICodexModelDefault(cfg);
    expect(applied.changed).toBe(true);
    expect(applied.next.agents?.defaults?.model).toEqual({
      primary: OPENAI_CODEX_DEFAULT_MODEL,
    });
  });

  it("injects openai-codex provider if even if model is already codex but provider is missing", () => {
    const cfg: VersoConfig = {
      agents: { defaults: { model: "openai-codex/gpt-5.2" } },
    };
    const applied = applyOpenAICodexModelDefault(cfg);
    expect(applied.changed).toBe(true);
    expect(applied.next.models?.providers?.["openai-codex"]).toBeDefined();
    expect(applied.next.agents?.defaults?.model).toBe("openai-codex/gpt-5.2");
  });
});
