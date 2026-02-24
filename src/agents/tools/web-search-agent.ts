/**
 * web-search-agent.ts
 *
 * Agent-aware web search tool built on top of the existing web_search providers.
 *
 * Key differences from plain web_search:
 *   1. Multi-factor query decomposition — the original query is projected onto
 *      a lightweight factor space (bigram-Jaccard, no embedding required) and
 *      split into N semantically orthogonal sub-queries.
 *   2. Parallel sub-query execution — all sub-queries run concurrently against
 *      the configured provider.
 *   3. URL-exact deduplication — results sharing the same URL are merged;
 *      the highest relevance score is kept and factor attribution is recorded.
 *   4. MMR diversity selection — Maximal Marginal Relevance over the merged
 *      pool ensures the final result set covers distinct topics rather than
 *      repeating the same source from multiple angles.
 *   5. Dynamic per-factor count — no hardcoded limits; each sub-query fetches
 *      ceil(targetTotal / factorCount) results so the raw pool is just large
 *      enough to feed the MMR step.
 *
 * The tool is registered as "web_search_agent" and is independent of the
 * existing "web_search" tool — both can coexist.
 */

import { Type } from "@sinclair/typebox";
import type { VersoConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { wrapWebContent } from "../../security/external-content.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import {
  normalizeCacheKey,
  readCache,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  writeCache,
  type CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  withTimeout,
  readResponseText,
} from "./web-shared.js";

// ---------- Constants ----------

const DEFAULT_MMR_LAMBDA = 0.7;
const DEFAULT_FACTOR_THRESHOLD = 0.15;
const DEFAULT_FACTOR_TOP_K = 4;
const DEFAULT_MMR_MIN_GAIN = 0.05;
const DEFAULT_BUDGET_TOKENS = 8000;

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

// ---------- Web factor space (no embeddings required) ----------

type WebFactor = {
  readonly id: string;
  readonly description: string;
  readonly subqueryTemplate: string;
};

/**
 * Lightweight factor space for web queries.
 * Uses bigram-Jaccard similarity — no embedding model needed.
 *
 * Each factor captures a distinct information dimension:
 *   factual    — direct facts, definitions, numbers
 *   background — context, history, how it works
 *   recent     — latest news, updates, current state
 *   comparison — alternatives, trade-offs, vs
 *   risk       — problems, failures, criticism, limitations
 *   tutorial   — how-to, examples, guides, code
 */
const WEB_FACTORS: readonly WebFactor[] = [
  {
    id: "factual",
    description: "direct facts definitions numbers statistics data",
    subqueryTemplate: "{query} facts definition overview",
  },
  {
    id: "background",
    description: "context history background how it works mechanism",
    subqueryTemplate: "{query} background context how it works",
  },
  {
    id: "recent",
    description: "latest news updates current state 2024 2025 recent",
    subqueryTemplate: "{query} latest news updates 2025",
  },
  {
    id: "comparison",
    description: "alternatives comparison versus trade-offs options",
    subqueryTemplate: "{query} comparison alternatives versus",
  },
  {
    id: "risk",
    description: "problems failures criticism limitations issues drawbacks",
    subqueryTemplate: "{query} problems issues limitations criticism",
  },
  {
    id: "tutorial",
    description: "how-to guide tutorial example code implementation steps",
    subqueryTemplate: "{query} tutorial guide example how to",
  },
] as const;

// ---------- Bigram similarity (no external deps) ----------

function bigramSet(s: string): Set<string> {
  const set = new Set<string>();
  const lower = s.toLowerCase();
  for (let i = 0; i < lower.length - 1; i++) {
    set.add(lower.slice(i, i + 2));
  }
  return set;
}

function bigramJaccard(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) {
    return 0;
  }
  const setA = bigramSet(a);
  const setB = bigramSet(b);
  let intersection = 0;
  for (const bg of setA) {
    if (setB.has(bg)) {
      intersection++;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------- Factor projection + selection ----------

type FactorScore = { factor: WebFactor; score: number };

function projectQueryToFactors(query: string): FactorScore[] {
  return WEB_FACTORS.map((factor) => ({
    factor,
    score: bigramJaccard(query, factor.description),
  }));
}

function selectTopFactors(scores: FactorScore[], threshold: number, topK: number): FactorScore[] {
  const passing = scores.filter((s) => s.score >= threshold);
  const pool = passing.length > 0 ? passing : scores;

  // MMR-style diversification across factors using bigram similarity
  const selected: FactorScore[] = [];
  const remaining = [...pool].toSorted((a, b) => b.score - a.score);

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].score;
      const maxSim =
        selected.length === 0
          ? 0
          : Math.max(
              ...selected.map((s) =>
                bigramJaccard(remaining[i].factor.description, s.factor.description),
              ),
            );
      const mmr = DEFAULT_MMR_LAMBDA * relevance - (1 - DEFAULT_MMR_LAMBDA) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    const [picked] = remaining.splice(bestIdx, 1);
    selected.push(picked);
  }

  return selected;
}

function buildSubqueries(
  query: string,
  selectedFactors: FactorScore[],
): Array<{ factorId: string; subquery: string }> {
  return selectedFactors.map(({ factor }) => ({
    factorId: factor.id,
    subquery: factor.subqueryTemplate.replace("{query}", query),
  }));
}

/**
 * Compute per-factor result count dynamically.
 * perFactorCount = ceil(targetTotal / factorCount)
 * No hardcoded upper limit — the caller controls targetTotal.
 */
function perFactorCount(targetTotal: number, factorCount: number): number {
  if (factorCount <= 0) {
    return targetTotal;
  }
  return Math.ceil(targetTotal / factorCount);
}

// ---------- Web result types ----------

type RawWebResult = {
  url: string;
  title: string;
  description: string;
  published?: string;
  siteName?: string;
  factorId: string;
  score: number;
};

type MergedWebResult = {
  url: string;
  title: string;
  description: string;
  published?: string;
  siteName?: string;
  score: number;
  factorsUsed: Array<{ id: string; score: number }>;
};

// ---------- Brave search (single sub-query) ----------

async function runBraveSubquery(params: {
  subquery: string;
  factorId: string;
  count: number;
  apiKey: string;
  timeoutSeconds: number;
  country?: string;
  searchLang?: string;
  uiLang?: string;
  freshness?: string;
}): Promise<RawWebResult[]> {
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", params.subquery);
  url.searchParams.set("count", String(params.count));
  if (params.country) {
    url.searchParams.set("country", params.country);
  }
  if (params.searchLang) {
    url.searchParams.set("search_lang", params.searchLang);
  }
  if (params.uiLang) {
    url.searchParams.set("ui_lang", params.uiLang);
  }
  if (params.freshness) {
    url.searchParams.set("freshness", params.freshness);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": params.apiKey,
    },
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`Brave Search API error (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> };
  };
  const results = Array.isArray(data.web?.results) ? (data.web?.results ?? []) : [];

  return results.map((entry, idx) => {
    const entryUrl = entry.url ?? "";
    let siteName: string | undefined;
    try {
      siteName = new URL(entryUrl).hostname;
    } catch {
      siteName = undefined;
    }
    // Score: position-based decay within this sub-query (1.0 → 1/(rank+1))
    const positionScore = 1 / (idx + 1);
    return {
      url: entryUrl,
      title: entry.title ? wrapWebContent(entry.title, "web_search") : "",
      description: entry.description ? wrapWebContent(entry.description, "web_search") : "",
      published: entry.age || undefined,
      siteName,
      factorId: params.factorId,
      score: positionScore,
    };
  });
}

// ---------- URL-exact deduplication ----------

function deduplicateWebResults(results: RawWebResult[]): MergedWebResult[] {
  const map = new Map<string, MergedWebResult>();

  for (const r of results) {
    const key = r.url.toLowerCase().replace(/\/$/, "");
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        url: r.url,
        title: r.title,
        description: r.description,
        published: r.published,
        siteName: r.siteName,
        score: r.score,
        factorsUsed: [{ id: r.factorId, score: r.score }],
      });
      continue;
    }

    // Keep highest score; merge factor attributions
    const mergedScore = Math.max(existing.score, r.score);
    const factorMap = new Map(existing.factorsUsed.map((f) => [f.id, f]));
    const prev = factorMap.get(r.factorId);
    if (!prev || r.score > prev.score) {
      factorMap.set(r.factorId, { id: r.factorId, score: r.score });
    }

    map.set(key, {
      ...existing,
      score: mergedScore,
      factorsUsed: [...factorMap.values()].toSorted((a, b) => b.score - a.score),
    });
  }

  return [...map.values()];
}

// ---------- MMR diversity selection with token budget ----------

function snippetSimilarity(a: MergedWebResult, b: MergedWebResult): number {
  return bigramJaccard(`${a.title} ${a.description}`, `${b.title} ${b.description}`);
}

function resultTokens(r: MergedWebResult): number {
  // ~4 chars per token is a reasonable approximation for web snippets
  return Math.ceil(`${r.title} ${r.description}`.length / 4);
}

function mmrSelectWebResults(
  candidates: MergedWebResult[],
  lambda: number,
  minGain: number,
  budgetTokens: number,
): MergedWebResult[] {
  if (candidates.length === 0) {
    return [];
  }

  const selected: MergedWebResult[] = [];
  const remaining = [...candidates];
  let tokensUsed = 0;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].score;
      const maxSim =
        selected.length === 0
          ? 0
          : Math.max(...selected.map((s) => snippetSimilarity(remaining[i], s)));
      const mmr = lambda * relevance - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    // Stop when marginal gain drops below threshold
    if (bestMmr < minGain) {
      break;
    }

    const candidate = remaining[bestIdx];
    const tokens = resultTokens(candidate);

    // Stop when token budget would be exceeded
    if (tokensUsed + tokens > budgetTokens) {
      break;
    }

    remaining.splice(bestIdx, 1);
    selected.push(candidate);
    tokensUsed += tokens;
  }

  return selected;
}

// ---------- Cache ----------

const AGENT_SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

// ---------- Config helpers (mirrors web-search.ts patterns) ----------

type WebSearchConfig = NonNullable<VersoConfig["tools"]>["web"] extends infer Web
  ? Web extends { search?: infer Search }
    ? Search
    : undefined
  : undefined;

function resolveSearchConfig(cfg?: VersoConfig): WebSearchConfig {
  const search = cfg?.tools?.web?.search;
  if (!search || typeof search !== "object") {
    return undefined;
  }
  return search as WebSearchConfig;
}

function resolveSearchApiKey(search?: WebSearchConfig): string | undefined {
  const fromConfig =
    search && "apiKey" in search && typeof search.apiKey === "string"
      ? normalizeSecretInput(search.apiKey)
      : "";
  const fromEnv = normalizeSecretInput(process.env.BRAVE_API_KEY);
  return fromConfig || fromEnv || undefined;
}

// ---------- Schema ----------

const WebSearchAgentSchema = Type.Object({
  query: Type.String({ description: "Search query string." }),
  country: Type.Optional(
    Type.String({
      description: "2-letter country code for region-specific results (e.g. 'US', 'DE').",
    }),
  ),
  search_lang: Type.Optional(Type.String({ description: "ISO language code for search results." })),
  ui_lang: Type.Optional(Type.String({ description: "ISO language code for UI elements." })),
  freshness: Type.Optional(
    Type.String({
      description:
        "Filter by discovery time: 'pd' (24h), 'pw' (week), 'pm' (month), 'py' (year), or 'YYYY-MM-DDtoYYYY-MM-DD'.",
    }),
  ),
  mmr_lambda: Type.Optional(
    Type.Number({
      description: `MMR trade-off: 1.0 = pure relevance, 0.0 = pure diversity. Defaults to ${DEFAULT_MMR_LAMBDA}.`,
      minimum: 0,
      maximum: 1,
    }),
  ),
  factor_top_k: Type.Optional(
    Type.Number({
      description: `Number of query dimensions (factors) to activate. Defaults to ${DEFAULT_FACTOR_TOP_K}.`,
      minimum: 1,
      maximum: WEB_FACTORS.length,
    }),
  ),
  results_per_factor: Type.Optional(
    Type.Number({
      description:
        "Number of raw results to fetch per factor sub-query. Defaults to ceil(10 / factorCount). Increase for broader coverage before MMR selection.",
      minimum: 1,
    }),
  ),
  budget_tokens: Type.Optional(
    Type.Number({
      description: `Token budget for result loading. MMR greedily selects the most diversity-increasing results until this budget is exhausted. Defaults to ${DEFAULT_BUDGET_TOKENS}.`,
      minimum: 100,
    }),
  ),
});

// ---------- Main pipeline ----------

async function runAgentSearch(params: {
  query: string;
  resultsPerFactor?: number;
  apiKey: string;
  timeoutSeconds: number;
  cacheTtlMs: number;
  mmrLambda: number;
  minMmrGain: number;
  budgetTokens: number;
  factorTopK: number;
  factorThreshold: number;
  country?: string;
  searchLang?: string;
  uiLang?: string;
  freshness?: string;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    `agent:${params.query}:${params.resultsPerFactor ?? "auto"}:${params.factorTopK}:${params.mmrLambda}:${params.budgetTokens}:${params.country ?? ""}:${params.freshness ?? ""}`,
  );
  const cached = readCache(AGENT_SEARCH_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  const start = Date.now();

  // 1. Project query onto factor space + select top-K diverse factors
  const factorScores = projectQueryToFactors(params.query);
  const selectedFactors = selectTopFactors(factorScores, params.factorThreshold, params.factorTopK);

  // 2. Build sub-queries
  const subqueries = buildSubqueries(params.query, selectedFactors);

  // 3. Dynamic per-factor count: provided by caller or ceil(10 / factorCount)
  const countPerFactor = params.resultsPerFactor ?? perFactorCount(10, subqueries.length);

  // 4. Parallel sub-query execution
  const subResults = await Promise.allSettled(
    subqueries.map(({ factorId, subquery }) =>
      runBraveSubquery({
        subquery,
        factorId,
        count: countPerFactor,
        apiKey: params.apiKey,
        timeoutSeconds: params.timeoutSeconds,
        country: params.country,
        searchLang: params.searchLang,
        uiLang: params.uiLang,
        freshness: params.freshness,
      }),
    ),
  );

  // Collect successful results; log failures as warnings
  const allRaw: RawWebResult[] = [];
  const factorErrors: string[] = [];
  for (let i = 0; i < subResults.length; i++) {
    const r = subResults[i];
    if (r.status === "fulfilled") {
      allRaw.push(...r.value);
    } else {
      factorErrors.push(`${subqueries[i].factorId}: ${String(r.reason)}`);
    }
  }

  // 5. URL-exact deduplication
  const merged = deduplicateWebResults(allRaw);

  // 6. MMR diversity selection — greedy, stops at minMmrGain or token budget
  const sorted = merged.toSorted((a, b) => b.score - a.score);
  const selected = mmrSelectWebResults(
    sorted,
    params.mmrLambda,
    params.minMmrGain,
    params.budgetTokens,
  );

  const payload: Record<string, unknown> = {
    query: params.query,
    provider: "brave",
    mode: "agent",
    factorsActivated: selectedFactors.map((f) => ({
      id: f.factor.id,
      score: f.score,
      subquery: subqueries.find((s) => s.factorId === f.factor.id)?.subquery,
    })),
    countPerFactor,
    rawCount: allRaw.length,
    mergedCount: merged.length,
    count: selected.length,
    tookMs: Date.now() - start,
    results: selected.map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description,
      published: r.published,
      siteName: r.siteName,
      score: r.score,
      factorsUsed: r.factorsUsed,
    })),
  };

  if (factorErrors.length > 0) {
    payload.warnings = factorErrors;
  }

  writeCache(AGENT_SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}

// ---------- Tool factory ----------

export function createWebSearchAgentTool(options?: { config?: VersoConfig }): AnyAgentTool | null {
  const search = resolveSearchConfig(options?.config);
  const apiKey = resolveSearchApiKey(search);

  // Only Brave is supported for multi-factor parallel search.
  // Perplexity/Grok are synthesis models — sub-query decomposition doesn't apply.
  const provider =
    search && "provider" in search && typeof search.provider === "string"
      ? search.provider.trim().toLowerCase()
      : "brave";

  if (provider !== "brave") {
    return null;
  }

  return {
    label: "Web Search (Agent)",
    name: "web_search_agent",
    description:
      "Multi-factor web search optimised for agents. Decomposes the query into semantically orthogonal sub-queries (factual, background, recent, comparison, risk, tutorial), runs them in parallel via Brave Search, deduplicates by URL, and applies MMR diversity selection. Returns a compact, diverse result set that covers multiple information dimensions rather than repeating the same source.",
    parameters: WebSearchAgentSchema,
    execute: async (_toolCallId, args) => {
      if (!apiKey) {
        return jsonResult({
          error: "missing_brave_api_key",
          message:
            "web_search_agent requires a Brave Search API key. Set BRAVE_API_KEY or configure tools.web.search.apiKey.",
        });
      }

      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const mmrLambda = (() => {
        const v = readNumberParam(params, "mmr_lambda");
        if (typeof v === "number" && Number.isFinite(v)) {
          return Math.max(0, Math.min(1, v));
        }
        return DEFAULT_MMR_LAMBDA;
      })();
      const factorTopK = Math.max(
        1,
        Math.min(
          WEB_FACTORS.length,
          Math.floor(
            readNumberParam(params, "factor_top_k", { integer: true }) ?? DEFAULT_FACTOR_TOP_K,
          ),
        ),
      );
      const resultsPerFactor = (() => {
        const v = readNumberParam(params, "results_per_factor", { integer: true });
        if (typeof v === "number" && v >= 1) {
          return Math.floor(v);
        }
        return undefined;
      })();

      const budgetTokens = (() => {
        const v = readNumberParam(params, "budget_tokens", { integer: true });
        if (typeof v === "number" && v >= 100) {
          return Math.floor(v);
        }
        return DEFAULT_BUDGET_TOKENS;
      })();

      const result = await runAgentSearch({
        query,
        resultsPerFactor,
        apiKey,
        timeoutSeconds: resolveTimeoutSeconds(
          search && "timeoutSeconds" in search ? (search.timeoutSeconds as number) : undefined,
          DEFAULT_TIMEOUT_SECONDS,
        ),
        cacheTtlMs: resolveCacheTtlMs(
          search && "cacheTtlMinutes" in search ? (search.cacheTtlMinutes as number) : undefined,
          DEFAULT_CACHE_TTL_MINUTES,
        ),
        mmrLambda,
        minMmrGain: DEFAULT_MMR_MIN_GAIN,
        budgetTokens,
        factorTopK,
        factorThreshold: DEFAULT_FACTOR_THRESHOLD,
        country: readStringParam(params, "country"),
        searchLang: readStringParam(params, "search_lang"),
        uiLang: readStringParam(params, "ui_lang"),
        freshness: readStringParam(params, "freshness"),
      });

      return jsonResult(result);
    },
  };
}

export const __testing = {
  projectQueryToFactors,
  selectTopFactors,
  buildSubqueries,
  perFactorCount,
  deduplicateWebResults,
  mmrSelectWebResults,
  WEB_FACTORS,
} as const;
