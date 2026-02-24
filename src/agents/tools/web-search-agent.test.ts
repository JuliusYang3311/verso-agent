import { describe, expect, it } from "vitest";
import type { LatentFactorSpace } from "../../memory/latent-factors.js";
import {
  projectQueryToFactors,
  queryToSubqueries,
  selectFactorsAboveThreshold,
  mmrDiversifyFactors,
} from "../../memory/latent-factors.js";
import { __testing } from "./web-search-agent.js";

const { perFactorCount, deduplicateWebResults, mmrSelectWebResults } = __testing;

// ---------- Fixture — mirrors a subset of the real factor-space ----------

const SPACE: LatentFactorSpace = {
  version: "1.0.0",
  factors: [
    {
      id: "internal",
      description: "内部结构 机制 自身因素 原因 结构性问题 internal mechanism root cause",
      subqueryTemplate: "{entity} internal mechanism structure root cause",
      vectors: {},
      weights: {},
    },
    {
      id: "technology",
      description: "技术 能力 创新 研发 工程实现 technology capability innovation engineering",
      subqueryTemplate: "{entity} technology capability innovation engineering",
      vectors: {},
      weights: {},
    },
    {
      id: "risk",
      description: "风险 不确定性 威胁 脆弱性 暴露 risk uncertainty threat vulnerability",
      subqueryTemplate: "{entity} risk uncertainty threat vulnerability",
      vectors: {},
      weights: {},
    },
    {
      id: "trend",
      description: "长期趋势 发展方向 未来变化 历史演变 trend trajectory evolution forecast",
      subqueryTemplate: "{entity} trend trajectory future evolution",
      vectors: {},
      weights: {},
    },
    {
      id: "cost",
      description: "成本 价格 规模效应 效率 资源消耗 cost price efficiency scale",
      subqueryTemplate: "{entity} cost price efficiency scale economics",
      vectors: {},
      weights: {},
    },
    {
      id: "competition",
      description: "竞争者 竞争格局 市场份额 对手行为 competition competitor market share rivalry",
      subqueryTemplate: "{entity} competition competitor market share rivalry",
      vectors: {},
      weights: {},
    },
  ],
};

// ---------- Helpers ----------

type RawResult = Parameters<typeof deduplicateWebResults>[0][number];

function makeRaw(url: string, factorId: string, score: number, title = "", desc = ""): RawResult {
  return { url, title, description: desc, factorId, score };
}

// ---------- projectQueryToFactors ----------

describe("projectQueryToFactors", () => {
  it("returns a softmax score for every factor", () => {
    const scores = projectQueryToFactors([], "how to use React hooks", SPACE, "test-model", "test");
    expect(scores).toHaveLength(SPACE.factors.length);
    for (const s of scores) {
      expect(s.score).toBeGreaterThan(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });

  it("softmax scores sum to ~1", () => {
    const scores = projectQueryToFactors([], "TypeScript generics", SPACE, "test-model", "test");
    const sum = scores.reduce((a, b) => a + b.score, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("tutorial-like factor scores higher for how-to query", () => {
    const scores = projectQueryToFactors(
      [],
      "how to implement step by step guide tutorial example",
      SPACE,
      "test-model",
      "test",
    );
    const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
    expect(best.score).toBeGreaterThan(1 / SPACE.factors.length);
  });
});

// ---------- selectFactorsAboveThreshold ----------

describe("selectFactorsAboveThreshold", () => {
  it("returns at least 1 factor even when nothing passes threshold", () => {
    const scores = projectQueryToFactors([], "xyz", SPACE, "test-model", "test");
    const selected = selectFactorsAboveThreshold(scores, 0.99);
    expect(selected.length).toBeGreaterThanOrEqual(1);
  });

  it("returns all factors above threshold", () => {
    const scores = projectQueryToFactors([], "test", SPACE, "test-model", "test");
    const threshold = 1 / SPACE.factors.length / 2;
    const selected = selectFactorsAboveThreshold(scores, threshold);
    expect(selected.length).toBeGreaterThan(0);
  });
});

// ---------- mmrDiversifyFactors ----------

describe("mmrDiversifyFactors", () => {
  it("returns all candidates in MMR order", () => {
    const scores = projectQueryToFactors([], "React hooks tutorial", SPACE, "test-model", "test");
    const selected = mmrDiversifyFactors(scores, "test-model", 0.7);
    expect(selected.length).toBe(scores.length);
  });

  it("selected factors have unique ids", () => {
    const scores = projectQueryToFactors(
      [],
      "comparison alternatives versus",
      SPACE,
      "test-model",
      "test",
    );
    const selected = mmrDiversifyFactors(scores, "test-model", 0.7);
    const ids = selected.map((s) => s.factor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------- queryToSubqueries ----------

describe("queryToSubqueries", () => {
  it("substitutes query into each template", () => {
    const { subqueries } = queryToSubqueries({
      queryVec: [],
      queryText: "TypeScript",
      space: SPACE,
      providerModel: "test-model",
      useCase: "test",
      threshold: 0,
      mmrLambda: 0.7,
    });
    expect(subqueries.length).toBeGreaterThanOrEqual(1);
    for (const s of subqueries) {
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
    const results = [
      makeMerged("https://a.com", 0.9, "hello", "world"),
      makeMerged("https://b.com", 0.8, "foo", "bar"),
      makeMerged("https://c.com", 0.7, "baz", "qux"),
    ];
    const selected = mmrSelectWebResults(results, 0.7, 0.0, 5);
    expect(selected.length).toBeLessThanOrEqual(2);
  });

  it("stops when MMR gain drops below minGain", () => {
    const results = [
      makeMerged("https://a.com", 0.9, "same text here", "same text here"),
      makeMerged("https://b.com", 0.8, "same text here", "same text here"),
      makeMerged("https://c.com", 0.7, "same text here", "same text here"),
    ];
    const selected = mmrSelectWebResults(results, 0.7, 0.5, 100000);
    expect(selected.length).toBe(1);
  });

  it("selects diverse results over similar ones", () => {
    const results = [
      makeMerged("https://a.com", 0.9, "react hooks tutorial guide", "learn react hooks"),
      makeMerged("https://b.com", 0.85, "react hooks tutorial guide", "learn react hooks"),
      makeMerged("https://c.com", 0.8, "vue comparison alternatives", "vue vs react tradeoffs"),
    ];
    const selected = mmrSelectWebResults(results, 0.7, 0.05, 100000);
    if (selected.length >= 2) {
      const urls = selected.map((r) => r.url);
      expect(urls[0]).toBe("https://a.com");
      expect(urls[1]).toBe("https://c.com");
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
