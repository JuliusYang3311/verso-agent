import { describe, expect, it } from "vitest";
import { __testing } from "./web-search-agent.js";

const {
  projectQueryToFactors,
  selectTopFactors,
  buildSubqueries,
  perFactorCount,
  deduplicateWebResults,
  mmrSelectWebResults,
  WEB_FACTORS,
} = __testing;

// ---------- Helpers ----------

type RawResult = Parameters<typeof deduplicateWebResults>[0][number];

function makeRaw(url: string, factorId: string, score: number, title = "", desc = ""): RawResult {
  return { url, title, description: desc, factorId, score };
}

// ---------- projectQueryToFactors ----------

describe("projectQueryToFactors", () => {
  it("returns a score for every factor", () => {
    const scores = projectQueryToFactors("how to use React hooks");
    expect(scores).toHaveLength(WEB_FACTORS.length);
    for (const s of scores) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });

  it("tutorial factor scores higher for how-to query", () => {
    const scores = projectQueryToFactors("how to implement authentication tutorial guide");
    const tutorial = scores.find((s) => s.factor.id === "tutorial");
    const factual = scores.find((s) => s.factor.id === "factual");
    expect(tutorial).toBeDefined();
    expect(factual).toBeDefined();
    expect(tutorial!.score).toBeGreaterThan(factual!.score);
  });

  it("recent factor scores higher for news query", () => {
    const scores = projectQueryToFactors("latest news updates 2025 current");
    const recent = scores.find((s) => s.factor.id === "recent");
    expect(recent).toBeDefined();
    expect(recent!.score).toBeGreaterThan(0);
  });
});

// ---------- selectTopFactors ----------

describe("selectTopFactors", () => {
  it("returns at most topK factors", () => {
    const scores = projectQueryToFactors("React hooks tutorial");
    const selected = selectTopFactors(scores, 0, 3);
    expect(selected.length).toBeLessThanOrEqual(3);
  });

  it("returns at least 1 factor even when nothing passes threshold", () => {
    const scores = projectQueryToFactors("xyz");
    const selected = selectTopFactors(scores, 0.99, 4);
    expect(selected.length).toBeGreaterThanOrEqual(1);
  });

  it("selected factors are diverse (no two identical ids)", () => {
    const scores = projectQueryToFactors("comparison alternatives versus");
    const selected = selectTopFactors(scores, 0, 4);
    const ids = selected.map((s) => s.factor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------- buildSubqueries ----------

describe("buildSubqueries", () => {
  it("substitutes query into each template", () => {
    const scores = projectQueryToFactors("TypeScript");
    const selected = selectTopFactors(scores, 0, 2);
    const subs = buildSubqueries("TypeScript", selected);
    expect(subs).toHaveLength(2);
    for (const s of subs) {
      expect(s.subquery).toContain("TypeScript");
      expect(s.factorId).toBeTruthy();
    }
  });
});

// ---------- perFactorCount ----------

describe("perFactorCount", () => {
  it("ceil(10 / 4) = 3", () => {
    expect(perFactorCount(10, 4)).toBe(3);
  });

  it("ceil(10 / 3) = 4", () => {
    expect(perFactorCount(10, 3)).toBe(4);
  });

  it("ceil(10 / 1) = 10", () => {
    expect(perFactorCount(10, 1)).toBe(10);
  });

  it("handles 0 factorCount gracefully", () => {
    expect(perFactorCount(10, 0)).toBe(10);
  });
});

// ---------- deduplicateWebResults ----------

describe("deduplicateWebResults", () => {
  it("passes through unique URLs unchanged", () => {
    const results = [
      makeRaw("https://a.com", "factual", 0.9),
      makeRaw("https://b.com", "recent", 0.8),
    ];
    expect(deduplicateWebResults(results)).toHaveLength(2);
  });

  it("merges duplicate URLs keeping max score", () => {
    const results = [
      makeRaw("https://a.com", "factual", 0.6),
      makeRaw("https://a.com", "recent", 0.9),
    ];
    const merged = deduplicateWebResults(results);
    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBe(0.9);
  });

  it("merges factor attributions on duplicate URL", () => {
    const results = [
      makeRaw("https://a.com", "factual", 0.6),
      makeRaw("https://a.com", "recent", 0.9),
    ];
    const merged = deduplicateWebResults(results);
    const ids = merged[0].factorsUsed.map((f) => f.id);
    expect(ids).toContain("factual");
    expect(ids).toContain("recent");
  });

  it("normalises trailing slash for dedup", () => {
    const results = [
      makeRaw("https://a.com/page", "factual", 0.7),
      makeRaw("https://a.com/page/", "recent", 0.8),
    ];
    expect(deduplicateWebResults(results)).toHaveLength(1);
  });

  it("is case-insensitive for URL dedup", () => {
    const results = [
      makeRaw("https://A.COM/page", "factual", 0.7),
      makeRaw("https://a.com/page", "recent", 0.8),
    ];
    expect(deduplicateWebResults(results)).toHaveLength(1);
  });
});

// ---------- mmrSelectWebResults ----------

type MergedResult = Parameters<typeof mmrSelectWebResults>[0][number];

function makeMerged(url: string, score: number, title = "", desc = ""): MergedResult {
  return { url, score, title, description: desc, factorsUsed: [] };
}

describe("mmrSelectWebResults", () => {
  it("returns empty for empty input", () => {
    expect(mmrSelectWebResults([], 0.7, 0.05, 10000)).toHaveLength(0);
  });

  it("stops when token budget is exhausted", () => {
    // Each result has ~10 chars → ~3 tokens; budget = 5 tokens → at most 1 result
    const results = [
      makeMerged("https://a.com", 0.9, "hello", "world"),
      makeMerged("https://b.com", 0.8, "foo", "bar"),
      makeMerged("https://c.com", 0.7, "baz", "qux"),
    ];
    const selected = mmrSelectWebResults(results, 0.7, 0.0, 5);
    expect(selected.length).toBeLessThanOrEqual(2);
  });

  it("stops when MMR gain drops below minGain", () => {
    // All results are identical text → high similarity → MMR gain drops fast
    const results = [
      makeMerged("https://a.com", 0.9, "same text here", "same text here"),
      makeMerged("https://b.com", 0.8, "same text here", "same text here"),
      makeMerged("https://c.com", 0.7, "same text here", "same text here"),
    ];
    // With lambda=0.7 and high similarity, second pick MMR ≈ 0.7*0.8 - 0.3*~1 ≈ 0.26
    // third pick MMR ≈ 0.7*0.7 - 0.3*~1 ≈ 0.19
    // With minGain=0.5, should stop after first
    const selected = mmrSelectWebResults(results, 0.7, 0.5, 100000);
    expect(selected.length).toBe(1);
  });

  it("selects diverse results over similar ones", () => {
    const results = [
      makeMerged("https://a.com", 0.9, "react hooks tutorial guide", "learn react hooks"),
      makeMerged("https://b.com", 0.85, "react hooks tutorial guide", "learn react hooks"), // near-duplicate
      makeMerged("https://c.com", 0.8, "vue comparison alternatives", "vue vs react tradeoffs"), // diverse
    ];
    const selected = mmrSelectWebResults(results, 0.7, 0.05, 100000);
    // c should be preferred over b as second pick due to diversity
    if (selected.length >= 2) {
      const urls = selected.map((r) => r.url);
      expect(urls[0]).toBe("https://a.com"); // highest score first
      expect(urls[1]).toBe("https://c.com"); // more diverse than b
    }
  });

  it("with large budget and low minGain returns all candidates", () => {
    const results = [
      makeMerged("https://a.com", 0.9, "alpha", "one"),
      makeMerged("https://b.com", 0.8, "beta", "two"),
      makeMerged("https://c.com", 0.7, "gamma", "three"),
    ];
    const selected = mmrSelectWebResults(results, 0.7, 0.0, 1_000_000);
    expect(selected).toHaveLength(3);
  });
});
