/**
 * Utility functions for provider-specific logic and capabilities.
 */

/**
 * Returns true if the provider requires reasoning to be wrapped in tags
 * (e.g. <think> and <final>) in the text stream, rather than using native
 * API fields for reasoning/thinking.
 */
export function isReasoningTagProvider(
  provider: string | undefined | null,
  model?: string | undefined | null,
): boolean {
  if (!provider) return false;
  const normalized = provider.trim().toLowerCase();
  const modelNormalized = model?.trim().toLowerCase() || "";

  // Check for exact matches or known prefixes/substrings for reasoning providers
  // (Removed google/ollama general providers to avoid forcing tags on standard models)

  // Handle google-antigravity and its model variations (e.g. google-antigravity/gemini-3)
  // REMOVED: Rely on model name keywords (reasoning/thinker) instead of blanket provider enforcement

  // Handle Minimax (M2.1 is chatty/reasoning-like)
  // Check both provider and model name to be robust (e.g. via OpenRouter)
  if (normalized.includes("minimax") || modelNormalized.includes("minimax")) {
    return true;
  }

  // Handle generic reasoning/thinking models (e.g. DeepSeek R1, "reasoner" models)
  if (
    modelNormalized.includes("reasoning") ||
    modelNormalized.includes("thinker") ||
    modelNormalized.includes("reasoner") ||
    modelNormalized.includes("thinking") || // Gemini Flash Thinking etc.
    // DeepSeek R1 and its variants (often served via OpenRouter as deepseek/deepseek-r1)
    modelNormalized.includes("deepseek-r1") ||
    // Some R1 distills/clones might just use R1 in the name
    (modelNormalized.includes("r1") &&
      (modelNormalized.includes("llama") || modelNormalized.includes("qwen")))
  ) {
    return true;
  }

  return false;
}
