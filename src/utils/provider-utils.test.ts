import { describe, expect, it } from "vitest";
import { isReasoningTagProvider } from "./provider-utils.js";

describe("isReasoningTagProvider", () => {
  it("should return true for known reasoning providers", () => {
    expect(isReasoningTagProvider("minimax")).toBe(true);
    expect(isReasoningTagProvider("google-antigravity")).toBe(true);
  });

  it("should return false for standard providers without reasoning model", () => {
    expect(isReasoningTagProvider("ollama")).toBe(false);
    expect(isReasoningTagProvider("google-gemini-cli")).toBe(false);
    expect(isReasoningTagProvider("openai")).toBe(false);
    expect(isReasoningTagProvider("anthropic")).toBe(false);
    expect(isReasoningTagProvider("openrouter")).toBe(false);
  });

  it("should return true for reasoning models regardless of provider", () => {
    expect(isReasoningTagProvider("openai", "o1-reasoning")).toBe(true);
    expect(isReasoningTagProvider("random", "my-thinker-v1")).toBe(true);
    expect(isReasoningTagProvider("openrouter", "deepseek/deepseek-r1")).toBe(true);
    expect(isReasoningTagProvider("openrouter", "deepseek/deepseek-r1-distill-llama-70b")).toBe(
      true,
    );
    expect(isReasoningTagProvider("aws", "deepseek-r1")).toBe(true);
    // Robustness check: Minimax purely via model name
    expect(isReasoningTagProvider("openrouter", "minimax/abab-6.5-chat")).toBe(true);
    // Robustness check: 'thinking' keyword
    expect(isReasoningTagProvider("google", "gemini-2.0-flash-thinking")).toBe(true);
  });

  it("should return false for standard models", () => {
    expect(isReasoningTagProvider("openai", "gpt-4o")).toBe(false);
    expect(isReasoningTagProvider("anthropic", "claude-3-opus")).toBe(false);
    expect(isReasoningTagProvider("openrouter", "meta-llama/llama-3-70b-instruct")).toBe(false);
  });

  it("should handle mixed case", () => {
    expect(isReasoningTagProvider("OpenRouter", "DeepSeek-R1")).toBe(true);
  });

  it("should handle undefined/null inputs", () => {
    expect(isReasoningTagProvider(undefined)).toBe(false);
    expect(isReasoningTagProvider(null)).toBe(false);
    expect(isReasoningTagProvider("openai", null)).toBe(false);
  });
});
