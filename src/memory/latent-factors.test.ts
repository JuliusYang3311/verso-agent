import { describe, expect, it } from "vitest";
import type { LatentFactorSpace } from "./latent-factors.js";
import {
  buildSubqueries,
  mmrDiversifyFactors,
  projectQueryToFactors,
  queryToSubqueries,
  selectFactorsAboveThreshold,
} from "./latent-factors.js";

// ---------- Fixtures ----------

const SPACE: LatentFactorSpace = {
  version: "1.0.0",
  factors: [
    {
      id: "internal",
      description: "internal mechanism root cause structure",
      subqueryTemplate: "{entity} internal mechanism structure",
      vectors: {},
      weights: {},
    },
    {
      id: "external",
      description: "external environment macro economy market",
      subqueryTemplate: "{entity} external environment macro",
      vectors: {},
      weights: {},
    },
    {
      id: "technology",
      description: "technology capability innovation engineering",
      subqueryTemplate: "{entity} technology capability innovation",
      vectors: {},
      weights: {},
    },
    {
      id: "risk",
      description: "risk uncertainty threat vulnerability exposure",
      subqueryTemplate: "{entity} risk uncertainty threat",
      vectors: {},
      weights: {},
    },
  ],
};

const MODEL = "text-embedding-3-small";

// Unit vectors for cosine tests
const VEC_A = [1, 0, 0, 0];
const VEC_B = [0, 1, 0, 0];
const VEC_C = [0, 0, 1, 0];
const VEC_D = [0, 0, 0, 1];

const SPACE_WITH_VECS: LatentFactorSpace = {
  version: "1.0.0",
  factors: [
    { ...SPACE.factors[0], vectors: { [MODEL]: VEC_A } },
    { ...SPACE.factors[1], vectors: { [MODEL]: VEC_B } },
    { ...SPACE.factors[2], vectors: { [MODEL]: VEC_C } },
    { ...SPACE.factors[3], vectors: { [MODEL]: VEC_D } },
  ],
};

// ---------- projectQueryToFactors ----------

describe("projectQueryToFactors", () => {
  it("uses cosine when factor vectors exist for providerModel", () => {
    const queryVec = [1, 0, 0, 0]; // identical to VEC_A
    const scores = projectQueryToFactors(
      queryVec,
      "internal mechanism",
      SPACE_WITH_VECS,
      MODEL,
      "test",
    );
    expect(scores).toHaveLength(4);
    const internal = scores.find((s) => s.factor.id === "internal")!;
    // After softmax, the factor with cosine=1 gets the highest score; others get ~0
    // rawScore for internal = 1.0, others = 0.0 → softmax(internal) ≈ e/(e+3) ≈ 0.475
    expect(internal.rawScore).toBeCloseTo(1.0);
    expect(internal.score).toBeGreaterThan(0.4); // highest after softmax
    const external = scores.find((s) => s.factor.id === "external")!;
    expect(external.rawScore).toBeCloseTo(0.0);
  });

  it("falls back to bigram-Jaccard when no vectors for providerModel", () => {
    const scores = projectQueryToFactors([], "internal mechanism root cause", SPACE, MODEL, "test");
    expect(scores).toHaveLength(4);
    // "internal mechanism root cause" shares bigrams with internal description
    const internal = scores.find((s) => s.factor.id === "internal")!;
    expect(internal.score).toBeGreaterThan(0);
    // All scores in [0, 1]
    for (const s of scores) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });

  it("returns a score for every factor in the space", () => {
    const scores = projectQueryToFactors([], "test query", SPACE, MODEL, "test");
    expect(scores.map((s) => s.factor.id)).toEqual(SPACE.factors.map((f) => f.id));
  });
});

// ---------- selectFactorsAboveThreshold ----------

describe("selectFactorsAboveThreshold", () => {
  it("returns factors at or above threshold", () => {
    const scores = projectQueryToFactors([1, 0, 0, 0], "q", SPACE_WITH_VECS, MODEL, "test");
    // After softmax, internal has the highest score (~0.475); use a threshold below that
    const threshold = 0.3;
    const selected = selectFactorsAboveThreshold(scores, threshold);
    expect(selected.every((s) => s.score >= threshold)).toBe(true);
    expect(selected.find((s) => s.factor.id === "internal")).toBeDefined();
  });

  it("returns the single best factor as fallback when nothing passes threshold", () => {
    const scores = projectQueryToFactors([], "zzz", SPACE, MODEL, "test");
    const selected = selectFactorsAboveThreshold(scores, 0.99);
    expect(selected).toHaveLength(1);
  });

  it("never returns empty array when input is non-empty", () => {
    const scores = projectQueryToFactors([], "query", SPACE, MODEL, "test");
    const selected = selectFactorsAboveThreshold(scores, 1.0);
    expect(selected.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------- mmrDiversifyFactors ----------

describe("mmrDiversifyFactors", () => {
  it("returns at most topK factors", () => {
    const scores = projectQueryToFactors([1, 0, 0, 0], "q", SPACE_WITH_VECS, MODEL, "test");
    const diversified = mmrDiversifyFactors(scores, MODEL, 0.7, 2);
    expect(diversified.length).toBeLessThanOrEqual(2);
  });

  it("with orthogonal unit vectors, selects topK distinct factors", () => {
    const scores = projectQueryToFactors([0.5, 0.5, 0.5, 0.5], "q", SPACE_WITH_VECS, MODEL, "test");
    const diversified = mmrDiversifyFactors(scores, MODEL, 0.7, 4);
    const ids = diversified.map((s) => s.factor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns empty array for empty input", () => {
    const result = mmrDiversifyFactors([], MODEL, 0.7, 4);
    expect(result).toHaveLength(0);
  });

  it("bigram fallback: diversifies by description similarity", () => {
    const scores = projectQueryToFactors([], "internal mechanism", SPACE, MODEL, "test");
    const diversified = mmrDiversifyFactors(scores, MODEL, 0.7, 3);
    expect(diversified.length).toBeLessThanOrEqual(3);
    const ids = diversified.map((s) => s.factor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------- buildSubqueries ----------

describe("buildSubqueries", () => {
  it("replaces {entity} in each template", () => {
    const scores = projectQueryToFactors([], "tesla", SPACE, MODEL, "test");
    const top2 = scores.slice(0, 2);
    const subqueries = buildSubqueries("tesla", top2);
    expect(subqueries).toHaveLength(2);
    for (const q of subqueries) {
      expect(q.subquery).toContain("tesla");
      expect(q.subquery).not.toContain("{entity}");
    }
  });

  it("returns empty array for empty factors", () => {
    expect(buildSubqueries("tesla", [])).toHaveLength(0);
  });
});

// ---------- queryToSubqueries (full pipeline) ----------

describe("queryToSubqueries", () => {
  it("end-to-end: returns selectedFactors and subqueries", () => {
    const result = queryToSubqueries({
      queryVec: [1, 0, 0, 0],
      queryText: "tesla internal mechanism",
      space: SPACE_WITH_VECS,
      providerModel: MODEL,
      useCase: "test",
      threshold: 0.3,
      mmrLambda: 0.7,
    });
    expect(result.selectedFactors.length).toBeGreaterThanOrEqual(1);
    expect(result.subqueries.length).toBe(result.selectedFactors.length);
    for (const q of result.subqueries) {
      expect(q.subquery).not.toContain("{entity}");
    }
  });

  it("bigram fallback pipeline works without vectors", () => {
    const result = queryToSubqueries({
      queryVec: [],
      queryText: "electric vehicle technology cost",
      space: SPACE,
      providerModel: MODEL,
      useCase: "test",
      threshold: 0.0,
      mmrLambda: 0.7,
    });
    expect(result.selectedFactors.length).toBeGreaterThanOrEqual(1);
    expect(result.subqueries.every((q) => q.subquery.length > 0)).toBe(true);
  });

  it("latentProjection snapshot covers all factors", () => {
    const scores = projectQueryToFactors([], "query", SPACE, MODEL, "test");
    expect(scores).toHaveLength(SPACE.factors.length);
  });
});
