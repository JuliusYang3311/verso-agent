/**
 * dynamic-context.ts
 * Dynamic context builder.
 * Does not use fixed top-k or fixed number of recent messages - everything is dynamic.
 *
 * Context is dynamically merged from two parts:
 *  A. Dynamic recent message retention (based on token budget)
 *  B. Dynamic vector retrieval (based on similarity threshold, not fixed top-k)
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { estimateTokens } from "@mariozechner/pi-coding-agent";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Type definitions ----------

export type ContextParams = {
  baseThreshold: number;
  thresholdFloor: number;
  timeDecayLambda: number;
  recentRatioBase: number;
  recentRatioMin: number;
  recentRatioMax: number;
  hybridVectorWeight: number;
  hybridBm25Weight: number;
  compactSafetyMargin: number;
  flushSoftThreshold: number;
};

export type RetrievedChunk = {
  snippet: string;
  score: number;
  path: string;
  source: string;
  startLine: number;
  endLine: number;
  timestamp?: number; // Message timestamp (used for time decay)
};

export type DynamicContextResult = {
  recentMessages: AgentMessage[];
  retrievedChunks: RetrievedChunk[];
  compactionSummary: string | null;
  recentTokens: number;
  retrievalTokens: number;
  totalTokens: number;
  recentRatioUsed: number;
  thresholdUsed: number;
};

// ---------- Default parameters ----------

export const DEFAULT_CONTEXT_PARAMS: ContextParams = {
  baseThreshold: 0.72,
  thresholdFloor: 0.5,
  timeDecayLambda: 0.01,
  recentRatioBase: 0.4,
  recentRatioMin: 0.2,
  recentRatioMax: 0.7,
  hybridVectorWeight: 0.7,
  hybridBm25Weight: 0.3,
  compactSafetyMargin: 1.2,
  flushSoftThreshold: 4000,
};

// ---------- Load params from evolver assets ----------

/**
 * Load context params from evolver assets.
 * Falls back to DEFAULT_CONTEXT_PARAMS if file doesn't exist or fails to load.
 */
export async function loadContextParams(): Promise<ContextParams> {
  try {
    const paramsPath = path.resolve(__dirname, "../evolver/assets/gep/context_params.json");
    const content = await fs.readFile(paramsPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<ContextParams>;
    return { ...DEFAULT_CONTEXT_PARAMS, ...parsed };
  } catch {
    // Fall back to defaults if file doesn't exist or parsing fails
    return DEFAULT_CONTEXT_PARAMS;
  }
}

// ---------- Dynamic recentRatio calculation ----------

/**
 * Dynamically adjust recent message ratio based on conversation patterns.
 * - Consecutive short messages → ratio increases
 * - Many tool calls → ratio decreases
 * - User references historical topics → ratio decreases
 */
export function computeDynamicRecentRatio(
  recentMessages: AgentMessage[],
  params: ContextParams,
): number {
  let ratio = params.recentRatioBase;

  if (recentMessages.length === 0) {
    return ratio;
  }

  // Calculate average token count of recent messages
  const recentTokenCounts = recentMessages.slice(-10).map((m) => estimateTokens(m));
  const avgTokens =
    recentTokenCounts.length > 0
      ? recentTokenCounts.reduce((a, b) => a + b, 0) / recentTokenCounts.length
      : 100;

  // Many short messages → fast conversation pace → ratio increases
  if (avgTokens < 50) {
    ratio += 0.1;
  } else if (avgTokens < 100) {
    ratio += 0.05;
  }

  // Many tool calls → ratio decreases
  const toolResultCount = recentMessages
    .slice(-10)
    .filter(
      (m) => m && typeof m === "object" && (m as { role?: string }).role === "toolResult",
    ).length;

  if (toolResultCount > 5) {
    ratio -= 0.15;
  } else if (toolResultCount > 3) {
    ratio -= 0.08;
  }

  // Constrain within min/max range
  return Math.max(params.recentRatioMin, Math.min(params.recentRatioMax, ratio));
}

// ---------- Time decay ----------

/**
 * Time decay factor: exp(-λ * hoursAgo)
 */
export function timeDecayFactor(timestampMs: number, lambda: number): number {
  const hoursAgo = (Date.now() - timestampMs) / 3_600_000;
  if (hoursAgo <= 0) {
    return 1;
  }
  return Math.exp(-lambda * hoursAgo);
}

// ---------- Dynamic recent message retention ----------

/**
 * Accumulate tokens from the latest message backward until reaching budget limit.
 * Returns retained messages and token count consumed.
 */
export function selectRecentMessages(
  allMessages: AgentMessage[],
  budgetTokens: number,
): { messages: AgentMessage[]; tokensUsed: number } {
  if (allMessages.length === 0 || budgetTokens <= 0) {
    return { messages: [], tokensUsed: 0 };
  }

  const selected: AgentMessage[] = [];
  let tokensUsed = 0;

  // From latest backward
  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msg = allMessages[i];
    const msgTokens = estimateTokens(msg);

    if (tokensUsed + msgTokens > budgetTokens && selected.length > 0) {
      break;
    }

    // Retain at least the most recent message
    selected.unshift(msg);
    tokensUsed += msgTokens;
  }

  return { messages: selected, tokensUsed };
}

// ---------- Dynamic vector retrieval filtering ----------

/**
 * Dynamically filter retrieval results based on similarity threshold.
 * Does not use fixed top-k, instead returns all results above threshold.
 * If results are empty, lower threshold and retry.
 * Applies time decay.
 */
export function filterRetrievedChunks(
  chunks: RetrievedChunk[],
  params: ContextParams,
  budgetTokens: number,
): { chunks: RetrievedChunk[]; tokensUsed: number; thresholdUsed: number } {
  if (chunks.length === 0) {
    return { chunks: [], tokensUsed: 0, thresholdUsed: params.baseThreshold };
  }

  // Apply time decay
  const decayed = chunks.map((chunk) => {
    const decay = chunk.timestamp ? timeDecayFactor(chunk.timestamp, params.timeDecayLambda) : 1;
    return { ...chunk, score: chunk.score * decay };
  });

  // Sort by score in descending order
  decayed.sort((a, b) => b.score - a.score);

  // Try filtering with baseThreshold
  let filtered = decayed.filter((c) => c.score >= params.baseThreshold);

  // If no results, lower threshold and retry
  if (filtered.length === 0) {
    filtered = decayed.filter((c) => c.score >= params.thresholdFloor);
  }

  // Truncate within budget
  const selected: RetrievedChunk[] = [];
  let tokensUsed = 0;

  for (const chunk of filtered) {
    const chunkTokens = estimateSnippetTokens(chunk.snippet);
    if (tokensUsed + chunkTokens > budgetTokens && selected.length > 0) {
      break;
    }
    selected.push(chunk);
    tokensUsed += chunkTokens;
  }

  const thresholdUsed =
    selected.length > 0 ? selected[selected.length - 1].score : params.baseThreshold;

  return { chunks: selected, tokensUsed, thresholdUsed };
}

function estimateSnippetTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

// ---------- Main entry point ----------

/**
 * Build dynamic context.
 *
 * @param allMessages     - Complete history message list
 * @param retrievedChunks - Candidate chunks returned by vector retrieval
 * @param contextLimit    - Model context window (tokens)
 * @param systemPromptTokens - Tokens consumed by system prompt
 * @param reserveForReply - Tokens reserved for reply
 * @param compactionSummary - History summary (if any)
 * @param params          - Dynamic parameters (can be tuned by Evolver)
 */
export function buildDynamicContext(options: {
  allMessages: AgentMessage[];
  retrievedChunks: RetrievedChunk[];
  contextLimit: number;
  systemPromptTokens: number;
  reserveForReply: number;
  compactionSummary?: string | null;
  params?: Partial<ContextParams>;
}): DynamicContextResult {
  const params = { ...DEFAULT_CONTEXT_PARAMS, ...options.params };
  const {
    allMessages,
    retrievedChunks,
    contextLimit,
    systemPromptTokens,
    reserveForReply,
    compactionSummary = null,
  } = options;

  // Total available budget
  const summaryTokens = compactionSummary ? estimateSnippetTokens(compactionSummary) : 0;
  const totalBudget = contextLimit - systemPromptTokens - reserveForReply - summaryTokens;

  if (totalBudget <= 0) {
    return {
      recentMessages: [],
      retrievedChunks: [],
      compactionSummary,
      recentTokens: 0,
      retrievalTokens: 0,
      totalTokens: systemPromptTokens + summaryTokens,
      recentRatioUsed: 0,
      thresholdUsed: params.baseThreshold,
    };
  }

  // Dynamically calculate recentRatio
  const recentRatio = computeDynamicRecentRatio(allMessages, params);

  // Allocate budget
  const recentBudget = Math.floor(totalBudget * recentRatio);
  const retrievalBudget = totalBudget - recentBudget;

  // A. Dynamic recent message retention
  const { messages: recentMessages, tokensUsed: recentTokens } = selectRecentMessages(
    allMessages,
    recentBudget,
  );

  // B. Dynamic vector retrieval filtering
  // Exclude content already in recent messages (avoid duplication)
  const recentSnippets = new Set(
    recentMessages
      .filter((m) => m && typeof m === "object")
      .map((m) => {
        const content = (m as { content?: string }).content || "";
        return content.slice(0, 100);
      })
      .filter(Boolean),
  );

  const nonDuplicateChunks = retrievedChunks.filter(
    (chunk) => !recentSnippets.has(chunk.snippet.slice(0, 100)),
  );

  const {
    chunks: filteredChunks,
    tokensUsed: retrievalTokens,
    thresholdUsed,
  } = filterRetrievedChunks(nonDuplicateChunks, params, retrievalBudget);

  return {
    recentMessages,
    retrievedChunks: filteredChunks,
    compactionSummary,
    recentTokens,
    retrievalTokens,
    totalTokens: systemPromptTokens + summaryTokens + recentTokens + retrievalTokens,
    recentRatioUsed: recentRatio,
    thresholdUsed,
  };
}
