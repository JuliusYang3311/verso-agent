/**
 * latent-factors.ts
 *
 * Latent Factor Space for multi-dimensional query projection.
 *
 * Core idea: project a query vector into an abstract cognitive factor space,
 * select top-K orthogonal factors via MMR, then generate sub-queries per factor
 * to drive parallel multi-source retrieval.
 *
 * Factor vectors are stored per embedding model (providerModel key) so that
 * cosine similarity is always computed within the same vector space.
 * When no pre-computed vector exists for the current model, the system falls
 * back to bigram-Jaccard similarity between the query text and factor descriptions.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Types ----------

/**
 * A single latent factor.
 * `vectors` is keyed by providerModel (e.g. "text-embedding-3-small").
 * An empty object means no pre-computed vectors yet → bigram fallback.
 */
export type LatentFactor = {
  id: string;
  description: string;
  subqueryTemplate: string;
  /** providerModel → embedding vector */
  vectors: Record<string, number[]>;
};

export type LatentFactorSpace = {
  version: string;
  factors: LatentFactor[];
};

export type FactorScore = {
  factor: LatentFactor;
  score: number;
};

// ---------- Load ----------

let _cachedSpace: LatentFactorSpace | null = null;

/**
 * Load the factor space from disk. Result is cached in-process.
 * Call `invalidateFactorSpaceCache()` after writing new vectors.
 */
export async function loadFactorSpace(): Promise<LatentFactorSpace> {
  if (_cachedSpace) {
    return _cachedSpace;
  }
  const p = path.resolve(__dirname, "factor-space.json");
  const raw = await fs.readFile(p, "utf-8");
  _cachedSpace = JSON.parse(raw) as LatentFactorSpace;
  return _cachedSpace;
}

export function invalidateFactorSpaceCache(): void {
  _cachedSpace = null;
}

/**
 * Persist updated factor vectors back to factor-space.json.
 * Typically called by an offline embedding script, not at query time.
 */
export async function saveFactorSpace(space: LatentFactorSpace): Promise<void> {
  const p = path.resolve(__dirname, "factor-space.json");
  await fs.writeFile(p, JSON.stringify(space, null, 2), "utf-8");
  _cachedSpace = space;
}

// ---------- Similarity helpers ----------

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

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

// ---------- Core projection API ----------

/**
 * Project a query into the factor space.
 *
 * If the factor has a pre-computed vector for `providerModel`, uses cosine similarity.
 * Otherwise falls back to bigram-Jaccard between `queryText` and the factor description.
 *
 * @param queryVec      Embedding vector of the query (may be empty for text-only fallback)
 * @param queryText     Raw query text (used for bigram fallback)
 * @param space         Loaded factor space
 * @param providerModel Current embedding model key (e.g. "text-embedding-3-small")
 */
export function projectQueryToFactors(
  queryVec: number[],
  queryText: string,
  space: LatentFactorSpace,
  providerModel: string,
): FactorScore[] {
  return space.factors.map((factor) => {
    const factorVec = factor.vectors[providerModel];
    const score =
      factorVec && factorVec.length > 0 && queryVec.length > 0
        ? cosine(queryVec, factorVec)
        : bigramJaccard(queryText, factor.description);
    return { factor, score };
  });
}

/**
 * Coarse threshold gate: keep only factors whose score >= threshold.
 * If nothing passes, returns the single highest-scoring factor as a fallback.
 */
export function selectFactorsAboveThreshold(
  scores: FactorScore[],
  threshold: number,
): FactorScore[] {
  const passing = scores.filter((s) => s.score >= threshold);
  if (passing.length > 0) {
    return passing;
  }
  // Fallback: return the best single factor so retrieval is never empty
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a), scores[0]);
  return best ? [best] : [];
}

/**
 * MMR-style diversification across factors.
 *
 * Selects up to `topK` factors that are both relevant (high score) and
 * mutually orthogonal (low inter-factor similarity).
 *
 * Inter-factor similarity uses:
 *   - cosine(factorVec_i, factorVec_j) if both have vectors for providerModel
 *   - bigramJaccard(description_i, description_j) otherwise
 *
 * MMR(f_i) = lambda * score_i - (1 - lambda) * max_{f_j ∈ selected} sim(f_i, f_j)
 */
export function mmrDiversifyFactors(
  candidates: FactorScore[],
  space: LatentFactorSpace,
  providerModel: string,
  lambda: number,
  topK: number,
): FactorScore[] {
  if (candidates.length === 0) {
    return [];
  }

  const selected: FactorScore[] = [];
  const remaining = [...candidates];

  const interSim = (a: LatentFactor, b: LatentFactor): number => {
    const va = a.vectors[providerModel];
    const vb = b.vectors[providerModel];
    if (va && vb && va.length > 0 && vb.length > 0) {
      return cosine(va, vb);
    }
    return bigramJaccard(a.description, b.description);
  };

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].score;
      const maxSim =
        selected.length === 0
          ? 0
          : Math.max(...selected.map((s) => interSim(remaining[i].factor, s.factor)));
      const mmr = lambda * relevance - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      break;
    }
    const [picked] = remaining.splice(bestIdx, 1);
    selected.push(picked);
  }

  return selected;
}

/**
 * Build sub-queries for each selected factor by filling the factor's template.
 * Template syntax: `{entity}` is replaced with the entity string.
 */
export function buildSubqueries(entity: string, selectedFactors: FactorScore[]): string[] {
  return selectedFactors.map(({ factor }) =>
    factor.subqueryTemplate.replace("{entity}", entity).trim(),
  );
}

/**
 * Convenience: full pipeline from query to sub-queries.
 *
 * Returns both the selected FactorScores (for metadata injection) and
 * the generated sub-query strings (for parallel retrieval).
 */
export function queryToSubqueries(params: {
  queryVec: number[];
  queryText: string;
  space: LatentFactorSpace;
  providerModel: string;
  threshold: number;
  topK: number;
  mmrLambda: number;
}): { selectedFactors: FactorScore[]; subqueries: string[] } {
  const { queryVec, queryText, space, providerModel, threshold, topK, mmrLambda } = params;

  const allScores = projectQueryToFactors(queryVec, queryText, space, providerModel);
  const aboveThreshold = selectFactorsAboveThreshold(allScores, threshold);
  const selectedFactors = mmrDiversifyFactors(
    aboveThreshold,
    space,
    providerModel,
    mmrLambda,
    topK,
  );
  const subqueries = buildSubqueries(queryText, selectedFactors);

  return { selectedFactors, subqueries };
}

/**
 * Register pre-computed embedding vectors for all factors under a given providerModel.
 * Vectors must be ordered to match space.factors order.
 * Persists to disk and invalidates cache.
 */
export async function registerFactorVectors(
  space: LatentFactorSpace,
  providerModel: string,
  vectors: number[][],
): Promise<LatentFactorSpace> {
  if (vectors.length !== space.factors.length) {
    throw new Error(
      `registerFactorVectors: expected ${space.factors.length} vectors, got ${vectors.length}`,
    );
  }
  const updated: LatentFactorSpace = {
    ...space,
    factors: space.factors.map((f, i) => ({
      ...f,
      vectors: { ...f.vectors, [providerModel]: vectors[i] },
    })),
  };
  await saveFactorSpace(updated);
  return updated;
}
