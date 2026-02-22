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
  // Hierarchical search params
  hierarchicalSearch?: boolean;
  hierarchicalFileLimit?: number;
  hierarchicalAlpha?: number;
  hierarchicalConvergenceRounds?: number;
  fileVectorWeight?: number;
  fileBm25Weight?: number;
  // L0/L1 generation params
  l0EmbeddingEnabled?: boolean;
  l1GenerationEnabled?: boolean;
  l1UseLlm?: boolean;
  l1LlmRateLimitMs?: number;
  // Progressive loading params
  progressiveLoadingEnabled?: boolean;
  progressiveL2MaxChunks?: number;
  // MMR diversity params
  mmrLambda?: number;
  // Write-side dedup params
  redundancyThreshold?: number;
};

export type RetrievedChunk = {
  snippet: string;
  score: number;
  path: string;
  source: string;
  startLine: number;
  endLine: number;
  timestamp?: number; // Message timestamp (used for time decay)
  l0Abstract?: string;
  l1Overview?: string;
  level?: "l0" | "l1" | "l2";
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
  mmrLambda: 0.6,
  redundancyThreshold: 0.95,
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
 * Bigram Jaccard similarity between two text snippets.
 * Used as a proxy for semantic similarity in MMR selection
 * (avoids needing embedding vectors at this layer).
 */
function bigramJaccard(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) {
    return 0;
  }
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    const lower = s.toLowerCase();
    for (let i = 0; i < lower.length - 1; i++) {
      set.add(lower.slice(i, i + 2));
    }
    return set;
  };
  const setA = bigrams(a);
  const setB = bigrams(b);
  let intersection = 0;
  for (const bg of setA) {
    if (setB.has(bg)) {
      intersection++;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * MMR (Maximal Marginal Relevance) greedy selection.
 * Selects chunks that maximize: λ * relevance - (1-λ) * max_similarity_to_selected.
 * This maximizes marginal information gain within the token budget.
 */
function mmrSelect(
  candidates: RetrievedChunk[],
  budgetTokens: number,
  mmrLambda: number,
): { chunks: RetrievedChunk[]; tokensUsed: number } {
  const selected: RetrievedChunk[] = [];
  let tokensUsed = 0;
  const remaining = [...candidates];

  while (remaining.length > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].score;
      const maxSim =
        selected.length === 0
          ? 0
          : Math.max(...selected.map((s) => bigramJaccard(remaining[i].snippet, s.snippet)));
      const mmr = mmrLambda * relevance - (1 - mmrLambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      break;
    }
    const [chunk] = remaining.splice(bestIdx, 1);
    const chunkTokens = estimateSnippetTokens(chunk.snippet);
    if (tokensUsed + chunkTokens > budgetTokens && selected.length > 0) {
      break;
    }
    selected.push(chunk);
    tokensUsed += chunkTokens;
  }

  return { chunks: selected, tokensUsed };
}

/**
 * Dynamically filter retrieval results based on similarity threshold.
 * Does not use fixed top-k, instead returns all results above threshold.
 * If results are empty, lower threshold and retry.
 * Applies time decay, then MMR diversity selection.
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

  // MMR diversity selection within budget
  const mmrLambda = params.mmrLambda ?? 0.6;
  const { chunks: selected, tokensUsed } = mmrSelect(filtered, budgetTokens, mmrLambda);

  const thresholdUsed =
    selected.length > 0 ? selected[selected.length - 1].score : params.baseThreshold;

  return { chunks: selected, tokensUsed, thresholdUsed };
}

function estimateSnippetTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

// ---------- Progressive loading (L0/L1/L2) ----------

/**
 * Progressively load chunks into the token budget.
 * Priority: L2 (full text) > L1 (overview) > L0 (abstract).
 * Maximizes information density within the budget.
 */
export function progressiveLoadChunks(
  chunks: RetrievedChunk[],
  params: ContextParams,
  budgetTokens: number,
): { chunks: RetrievedChunk[]; tokensUsed: number } {
  if (chunks.length === 0 || budgetTokens <= 0) {
    return { chunks: [], tokensUsed: 0 };
  }

  const l2MaxChunks = params.progressiveL2MaxChunks ?? 5;
  const selected: RetrievedChunk[] = [];
  let tokensUsed = 0;
  let l2Count = 0;

  for (const chunk of chunks) {
    if (tokensUsed >= budgetTokens) {
      break;
    }

    const l2Tokens = estimateSnippetTokens(chunk.snippet);
    const l1Text = chunk.l1Overview || "";
    const l1Tokens = l1Text ? estimateSnippetTokens(l1Text) : 0;
    const l0Text = chunk.l0Abstract || "";
    const l0Tokens = l0Text ? estimateSnippetTokens(l0Text) : 0;

    // Try L2 (full snippet) first
    if (tokensUsed + l2Tokens <= budgetTokens && l2Count < l2MaxChunks) {
      selected.push({ ...chunk, level: "l2" });
      tokensUsed += l2Tokens;
      l2Count++;
      continue;
    }

    // Try L1 (overview) if available
    if (l1Text && tokensUsed + l1Tokens <= budgetTokens) {
      selected.push({
        ...chunk,
        snippet: l1Text,
        level: "l1",
      });
      tokensUsed += l1Tokens;
      continue;
    }

    // Try L0 (abstract) — always fits if short enough
    if (l0Text && tokensUsed + l0Tokens <= budgetTokens) {
      selected.push({
        ...chunk,
        snippet: l0Text,
        level: "l0",
      });
      tokensUsed += l0Tokens;
      continue;
    }

    // Nothing fits, stop
    if (selected.length > 0) {
      break;
    }
  }

  return { chunks: selected, tokensUsed };
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
  } = params.progressiveLoadingEnabled
    ? (() => {
        // Apply time decay + threshold filter first, then MMR reorder, then progressive loading
        const decayed = nonDuplicateChunks.map((chunk) => {
          const decay = chunk.timestamp
            ? timeDecayFactor(chunk.timestamp, params.timeDecayLambda)
            : 1;
          return { ...chunk, score: chunk.score * decay };
        });
        decayed.sort((a, b) => b.score - a.score);
        let filtered = decayed.filter((c) => c.score >= params.baseThreshold);
        if (filtered.length === 0) {
          filtered = decayed.filter((c) => c.score >= params.thresholdFloor);
        }
        // MMR reorder before progressive loading
        const mmrLambda = params.mmrLambda ?? 0.6;
        const mmrResult = mmrSelect(filtered, retrievalBudget, mmrLambda);
        const result = progressiveLoadChunks(mmrResult.chunks, params, retrievalBudget);
        const threshold =
          result.chunks.length > 0
            ? result.chunks[result.chunks.length - 1].score
            : params.baseThreshold;
        return {
          chunks: result.chunks,
          tokensUsed: result.tokensUsed,
          thresholdUsed: threshold,
        };
      })()
    : filterRetrievedChunks(nonDuplicateChunks, params, retrievalBudget);

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
