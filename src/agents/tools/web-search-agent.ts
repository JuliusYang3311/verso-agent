/**
 * web-search-agent.ts
 *
 * Agent-aware web search tool built on top of the existing web_search providers.
 *
 * Key differences from plain web_search:
 *   1. Multi-factor query decomposition — the query is projected onto the shared
 *      latent factor space (factor-space.json) using softmax-normalised weighted
 *      cosine similarity (embedding) or bigram-Jaccard fallback.
 *   2. Parallel sub-query execution — all sub-queries run concurrently.
 *   3. URL-exact deduplication — results sharing the same URL are merged.
 *   4. MMR diversity selection — Maximal Marginal Relevance over the merged pool.
 *   5. Dynamic per-factor count — ceil(targetTotal / factorCount).
 *   6. Lazy factor embedding — if the current model has no factor vectors yet,
 *      triggers async embedding (fire-and-forget) and falls back to bigram-Jaccard
 *      for the current query.
 *
 * The tool is registered as "web_search_agent" and is independent of the
 * existing "web_search" tool — both can coexist.
 */

import { Type } from "@sinclair/typebox";
import type { VersoConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import {
  loadFactorSpace,
  queryToSubqueries,
  ensureFactorVectors,
  type FactorScore,
  type LatentFactorSpace,
} from "../../memory/latent-factors.js";
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
const DEFAULT_FACTOR_TOP_K = 4;
const DEFAULT_MMR_MIN_GAIN = 0.05;
const DEFAULT_BUDGET_TOKENS = 8000;
const WEB_PROVIDER_MODEL = "web-search-agent"; // key used in factor-space.json for web factors

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

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
    return {
      url: entryUrl,
      title: entry.title ? wrapWebContent(entry.title, "web_search") : "",
      description: entry.description ? wrapWebContent(entry.description, "web_search") : "",
      published: entry.age || undefined,
      siteName,
      factorId: params.factorId,
      score: 1 / (idx + 1), // position-based decay
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
  // Bigram-Jaccard over title+description — no embedding needed for result-level MMR
  const bigramSet = (s: string): Set<string> => {
    const set = new Set<string>();
    const lower = s.toLowerCase();
    for (let i = 0; i < lower.length - 1; i++) {
      set.add(lower.slice(i, i + 2));
    }
    return set;
  };
  const text = (r: MergedWebResult) => `${r.title} ${r.description}`;
  const setA = bigramSet(text(a));
  const setB = bigramSet(text(b));
  let intersection = 0;
  for (const bg of setA) {
    if (setB.has(bg)) {
      intersection++;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function resultTokens(r: MergedWebResult): number {
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

    if (bestMmr < minGain) {
      break;
    }

    const candidate = remaining[bestIdx];
    if (tokensUsed + resultTokens(candidate) > budgetTokens) {
      break;
    }

    remaining.splice(bestIdx, 1);
    selected.push(candidate);
    tokensUsed += resultTokens(candidate);
  }

  return selected;
}

// ---------- Per-factor count ----------

function perFactorCount(targetTotal: number, factorCount: number): number {
  return factorCount <= 0 ? targetTotal : Math.ceil(targetTotal / factorCount);
}

// ---------- Cache ----------

const AGENT_SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

// ---------- Config helpers ----------

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
      maximum: 20,
    }),
  ),
  results_per_factor: Type.Optional(
    Type.Number({
      description:
        "Number of raw results to fetch per factor sub-query. Defaults to ceil(10 / factorCount).",
      minimum: 1,
    }),
  ),
  budget_tokens: Type.Optional(
    Type.Number({
      description: `Token budget for MMR result selection. Defaults to ${DEFAULT_BUDGET_TOKENS}.`,
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
  country?: string;
  searchLang?: string;
  uiLang?: string;
  freshness?: string;
  embedBatch?: (texts: string[]) => Promise<number[][]>;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    `agent:${params.query}:${params.resultsPerFactor ?? "auto"}:${params.factorTopK}:${params.mmrLambda}:${params.budgetTokens}:${params.country ?? ""}:${params.freshness ?? ""}`,
  );
  const cached = readCache(AGENT_SEARCH_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  const start = Date.now();

  // 1. Load factor space; trigger lazy embedding if needed (fire-and-forget)
  const space: LatentFactorSpace = await loadFactorSpace();
  if (params.embedBatch) {
    void ensureFactorVectors(space, WEB_PROVIDER_MODEL, "web", params.embedBatch).catch(() => {});
  }

  // 2. Project query onto factor space (softmax-normalised weighted cosine / bigram fallback)
  const { selectedFactors, subqueries } = queryToSubqueries({
    queryVec: [], // web-search-agent has no query embedding at call time; uses bigram fallback
    queryText: params.query,
    space,
    providerModel: WEB_PROVIDER_MODEL,
    useCase: "web",
    threshold: 1 / space.factors.length,
    topK: params.factorTopK,
    mmrLambda: params.mmrLambda,
  });

  // 3. Dynamic per-factor count
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

  // 6. MMR diversity selection
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
    factorsActivated: selectedFactors.map((f: FactorScore) => ({
      id: f.factor.id,
      score: f.score,
      rawScore: f.rawScore,
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

export function createWebSearchAgentTool(options?: {
  config?: VersoConfig;
  embedBatch?: (texts: string[]) => Promise<number[][]>;
}): AnyAgentTool | null {
  const search = resolveSearchConfig(options?.config);
  const apiKey = resolveSearchApiKey(search);

  // Only Brave is supported for multi-factor parallel search.
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
      "Multi-factor web search optimised for agents. Decomposes the query into semantically orthogonal sub-queries via the shared latent factor space, runs them in parallel via Brave Search, deduplicates by URL, and applies MMR diversity selection. Returns a compact, diverse result set covering multiple information dimensions.",
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
        return typeof v === "number" && Number.isFinite(v)
          ? Math.max(0, Math.min(1, v))
          : DEFAULT_MMR_LAMBDA;
      })();

      const factorTopK = Math.max(
        1,
        Math.floor(
          readNumberParam(params, "factor_top_k", { integer: true }) ?? DEFAULT_FACTOR_TOP_K,
        ),
      );

      const resultsPerFactor = (() => {
        const v = readNumberParam(params, "results_per_factor", { integer: true });
        return typeof v === "number" && v >= 1 ? Math.floor(v) : undefined;
      })();

      const budgetTokens = (() => {
        const v = readNumberParam(params, "budget_tokens", { integer: true });
        return typeof v === "number" && v >= 100 ? Math.floor(v) : DEFAULT_BUDGET_TOKENS;
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
        country: readStringParam(params, "country"),
        searchLang: readStringParam(params, "search_lang"),
        uiLang: readStringParam(params, "ui_lang"),
        freshness: readStringParam(params, "freshness"),
        embedBatch: options?.embedBatch,
      });

      return jsonResult(result);
    },
  };
}

export const __testing = {
  deduplicateWebResults,
  mmrSelectWebResults,
  perFactorCount,
} as const;
