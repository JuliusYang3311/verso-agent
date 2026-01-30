import type { VersoConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { note } from "../terminal/note.js";
import { confirm, text } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";

const DEFAULT_CONTEXT_TOKENS = 200_000;
const DEFAULT_RESERVE_TOKENS_FLOOR = 8_000;
const DEFAULT_MEMORY_FLUSH_SOFT_TOKENS = 8_000;

/**
 * Prompt the user for context window and compaction settings.
 * These settings control how the agent manages context overflow and memory.
 */
export async function promptContextConfig(
  nextConfig: VersoConfig,
  runtime: RuntimeEnv,
): Promise<VersoConfig> {
  const existingDefaults = nextConfig.agents?.defaults;
  const existingCompaction = existingDefaults?.compaction;
  const existingMemoryFlush = existingCompaction?.memoryFlush;

  note(
    [
      "Context settings control how the agent manages conversation history.",
      "",
      "• Context window: Maximum tokens the model can process at once.",
      "• Reserve tokens: Buffer kept for new responses during compaction.",
      "• Memory flush: Saves important memories before compaction kicks in.",
      "",
      "Docs: https://docs.molt.bot/agents/compaction",
    ].join("\n"),
    "Context & Compaction",
  );

  // 1. Context tokens (model context window)
  const contextTokensRaw = guardCancel(
    await text({
      message: "Model context window (tokens)",
      initialValue: String(existingDefaults?.contextTokens ?? DEFAULT_CONTEXT_TOKENS),
      placeholder: "e.g., 200000 for Claude, 2000000 for Gemini 2.0",
    }),
    runtime,
  );
  const contextTokens = Number.parseInt(String(contextTokensRaw).trim(), 10);
  const validContextTokens =
    Number.isFinite(contextTokens) && contextTokens > 0
      ? contextTokens
      : (existingDefaults?.contextTokens ?? DEFAULT_CONTEXT_TOKENS);

  // 2. Reserve tokens floor (compaction buffer)
  const reserveTokensRaw = guardCancel(
    await text({
      message: "Compaction buffer (tokens to reserve for new responses)",
      initialValue: String(existingCompaction?.reserveTokensFloor ?? DEFAULT_RESERVE_TOKENS_FLOOR),
      placeholder: "Lower = earlier compaction (recommended: 4000-12000)",
    }),
    runtime,
  );
  const reserveTokensFloor = Number.parseInt(String(reserveTokensRaw).trim(), 10);
  const validReserveTokens =
    Number.isFinite(reserveTokensFloor) && reserveTokensFloor >= 0
      ? reserveTokensFloor
      : (existingCompaction?.reserveTokensFloor ?? DEFAULT_RESERVE_TOKENS_FLOOR);

  // 3. Memory flush enabled
  const memoryFlushEnabled = guardCancel(
    await confirm({
      message: "Enable pre-compaction memory flush? (saves memories before compacting)",
      initialValue: existingMemoryFlush?.enabled ?? true,
    }),
    runtime,
  );

  // 4. Memory flush soft threshold (only if enabled)
  let memoryFlushSoftTokens =
    existingMemoryFlush?.softThresholdTokens ?? DEFAULT_MEMORY_FLUSH_SOFT_TOKENS;
  if (memoryFlushEnabled) {
    const softTokensRaw = guardCancel(
      await text({
        message: "Memory flush threshold (tokens before compaction to trigger flush)",
        initialValue: String(memoryFlushSoftTokens),
        placeholder: "Higher = more time for memory flush (recommended: 6000-12000)",
      }),
      runtime,
    );
    const parsed = Number.parseInt(String(softTokensRaw).trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      memoryFlushSoftTokens = parsed;
    }
  }

  return {
    ...nextConfig,
    agents: {
      ...nextConfig.agents,
      defaults: {
        ...existingDefaults,
        contextTokens: validContextTokens,
        compaction: {
          ...existingCompaction,
          reserveTokensFloor: validReserveTokens,
          memoryFlush: {
            ...existingMemoryFlush,
            enabled: memoryFlushEnabled,
            softThresholdTokens: memoryFlushSoftTokens,
          },
        },
      },
    },
  };
}
