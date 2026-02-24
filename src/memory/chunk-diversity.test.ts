import { describe, expect, it } from "vitest";
import {
  applyDiversityPipeline,
  chunkKey,
  chunkSimilarity,
  deduplicateChunks,
  mmrSelectChunks,
  type DiverseChunk,
} from "./chunk-diversity.js";

// ---------- Fixtures ----------

function makeChunk(
  path: string,
  startLine: number,
  score: number,
  snippet: string,
  embedding?: number[],
  factorsUsed?: Array<{ id: string; score: number }>,
): DiverseChunk {
  return {
    key: chunkKey(path, startLine),
    path,
    startLine,
    endLine: startLine + 10,
    snippet,
    score,
    source: "memory",
    embedding,
    factorsUsed,
  };
}

// Unit orthogonal vectors
const V_A = [1, 0, 0, 0];
const V_B = [0, 1, 0, 0];
const V_C = [0, 0, 1, 0];

// ---------- chunkKey ----------

describe("chunkKey", () => {
  it("produces stable identity key", () => {
    expect(chunkKey("src/foo.ts", 42)).toBe("src/foo.ts:42");
  });
});

// ---------- deduplicateChunks ----------

describe("deduplicateChunks", () => {
  it("passes through unique chunks unchanged", () => {
    const chunks = [makeChunk("a.ts", 1, 0.9, "alpha"), makeChunk("b.ts", 1, 0.8, "beta")];
    expect(deduplicateChunks(chunks)).toHaveLength(2);
  });

  it("collapses duplicate (path, startLine) keeping max score", () => {
    const chunks = [
      makeChunk("a.ts", 1, 0.6, "alpha", undefined, [{ id: "internal", score: 0.8 }]),
      makeChunk("a.ts", 1, 0.9, "alpha", undefined, [{ id: "risk", score: 0.7 }]),
    ];
    const result = deduplicateChunks(chunks);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.9);
  });

  it("merges factorsUsed from all duplicates, deduped by id, highest score wins", () => {
    const chunks = [
      makeChunk("a.ts", 1, 0.9, "alpha", undefined, [
        { id: "internal", score: 0.8 },
        { id: "risk", score: 0.5 },
      ]),
      makeChunk("a.ts", 1, 0.7, "alpha", undefined, [
        { id: "internal", score: 0.6 }, // lower — should be ignored
        { id: "technology", score: 0.9 },
      ]),
    ];
    const result = deduplicateChunks(chunks);
    expect(result).toHaveLength(1);
    const factors = result[0].factorsUsed!;
    const ids = factors.map((f) => f.id);
    expect(ids).toContain("internal");
    expect(ids).toContain("risk");
    expect(ids).toContain("technology");
    // internal should keep score 0.8 (higher)
    expect(factors.find((f) => f.id === "internal")!.score).toBe(0.8);
    // sorted by score desc
    expect(factors[0].score).toBeGreaterThanOrEqual(factors[1].score);
  });

  it("keeps first non-empty embedding", () => {
    const chunks = [
      makeChunk("a.ts", 1, 0.9, "alpha", V_A),
      makeChunk("a.ts", 1, 0.7, "alpha", V_B),
    ];
    const result = deduplicateChunks(chunks);
    expect(result[0].embedding).toEqual(V_A);
  });
});

// ---------- chunkSimilarity ----------

describe("chunkSimilarity", () => {
  it("uses cosine when both chunks have embeddings", () => {
    const a = makeChunk("a.ts", 1, 0.9, "foo", V_A);
    const b = makeChunk("b.ts", 1, 0.8, "bar", V_A);
    expect(chunkSimilarity(a, b)).toBeCloseTo(1.0);
  });

  it("returns 0 for orthogonal embedding vectors", () => {
    const a = makeChunk("a.ts", 1, 0.9, "foo", V_A);
    const b = makeChunk("b.ts", 1, 0.8, "bar", V_B);
    expect(chunkSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it("falls back to bigram-Jaccard when no embeddings", () => {
    const a = makeChunk("a.ts", 1, 0.9, "hello world");
    const b = makeChunk("b.ts", 1, 0.8, "hello world");
    expect(chunkSimilarity(a, b)).toBeCloseTo(1.0);
  });

  it("bigram fallback: dissimilar texts have low similarity", () => {
    const a = makeChunk("a.ts", 1, 0.9, "quantum physics");
    const b = makeChunk("b.ts", 1, 0.8, "cooking recipes");
    expect(chunkSimilarity(a, b)).toBeLessThan(0.3);
  });

  it("falls back to bigram when one chunk has no embedding", () => {
    const a = makeChunk("a.ts", 1, 0.9, "hello world", V_A);
    const b = makeChunk("b.ts", 1, 0.8, "hello world"); // no embedding
    // Should use bigram fallback, not cosine
    expect(chunkSimilarity(a, b)).toBeGreaterThan(0);
  });
});

// ---------- mmrSelectChunks ----------

describe("mmrSelectChunks", () => {
  it("returns empty for empty input", () => {
    expect(mmrSelectChunks([], 1000, 0.7).chunks).toHaveLength(0);
  });

  it("returns empty when budget is 0", () => {
    const chunks = [makeChunk("a.ts", 1, 0.9, "hello")];
    expect(mmrSelectChunks(chunks, 0, 0.7).chunks).toHaveLength(0);
  });

  it("selects chunks within token budget", () => {
    // Each snippet ~5 chars → ~2 tokens; budget = 4 tokens → fits 2
    const chunks = [
      makeChunk("a.ts", 1, 0.9, "hello", V_A),
      makeChunk("b.ts", 1, 0.8, "world", V_B),
      makeChunk("c.ts", 1, 0.7, "extra", V_C),
    ];
    const { chunks: selected, tokensUsed } = mmrSelectChunks(chunks, 4, 0.7);
    expect(selected.length).toBeLessThanOrEqual(2);
    expect(tokensUsed).toBeLessThanOrEqual(4);
  });

  it("skips chunks that don't fit but continues for smaller ones", () => {
    // Large chunk first, then small ones
    const large = makeChunk("a.ts", 1, 0.95, "x".repeat(400)); // ~100 tokens
    const small1 = makeChunk("b.ts", 1, 0.8, "hi"); // ~1 token
    const small2 = makeChunk("c.ts", 1, 0.7, "ok"); // ~1 token
    const { chunks: selected } = mmrSelectChunks([large, small1, small2], 10, 0.7);
    // large doesn't fit, but small ones should be selected
    const ids = selected.map((c) => c.path);
    expect(ids).toContain("b.ts");
    expect(ids).toContain("c.ts");
    expect(ids).not.toContain("a.ts");
  });

  it("with orthogonal embeddings, selects diverse chunks", () => {
    const chunks = [
      makeChunk("a.ts", 1, 0.9, "alpha alpha alpha", V_A),
      makeChunk("b.ts", 1, 0.85, "beta beta beta", V_B),
      makeChunk("c.ts", 1, 0.8, "gamma gamma gamma", V_C),
    ];
    const { chunks: selected } = mmrSelectChunks(chunks, 10000, 0.7);
    // All three are orthogonal — all should be selected
    expect(selected).toHaveLength(3);
  });
});

// ---------- applyDiversityPipeline ----------

describe("applyDiversityPipeline", () => {
  it("returns empty for empty input", () => {
    const result = applyDiversityPipeline({
      chunks: [],
      budgetTokens: 1000,
      threshold: 0.5,
      thresholdFloor: 0.3,
      mmrLambda: 0.7,
    });
    expect(result.chunks).toHaveLength(0);
    expect(result.tokensUsed).toBe(0);
  });

  it("deduplicates before filtering", () => {
    const chunks = [
      makeChunk("a.ts", 1, 0.9, "hello world"),
      makeChunk("a.ts", 1, 0.8, "hello world"), // duplicate
      makeChunk("b.ts", 1, 0.7, "other text"),
    ];
    const result = applyDiversityPipeline({
      chunks,
      budgetTokens: 10000,
      threshold: 0.5,
      thresholdFloor: 0.3,
      mmrLambda: 0.7,
    });
    // After dedup: 2 unique chunks, both above threshold
    expect(result.chunks).toHaveLength(2);
  });

  it("falls back to thresholdFloor when nothing passes primary threshold", () => {
    const chunks = [makeChunk("a.ts", 1, 0.4, "hello"), makeChunk("b.ts", 1, 0.35, "world")];
    const result = applyDiversityPipeline({
      chunks,
      budgetTokens: 10000,
      threshold: 0.8, // nothing passes
      thresholdFloor: 0.3,
      mmrLambda: 0.7,
    });
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it("returns empty when nothing passes even the floor", () => {
    const chunks = [makeChunk("a.ts", 1, 0.1, "hello")];
    const result = applyDiversityPipeline({
      chunks,
      budgetTokens: 10000,
      threshold: 0.8,
      thresholdFloor: 0.5,
      mmrLambda: 0.7,
    });
    expect(result.chunks).toHaveLength(0);
  });

  it("thresholdUsed reflects last selected chunk score", () => {
    const chunks = [makeChunk("a.ts", 1, 0.9, "alpha"), makeChunk("b.ts", 1, 0.7, "beta")];
    const result = applyDiversityPipeline({
      chunks,
      budgetTokens: 10000,
      threshold: 0.5,
      thresholdFloor: 0.3,
      mmrLambda: 0.7,
    });
    expect(result.thresholdUsed).toBeGreaterThan(0);
    expect(result.thresholdUsed).toBeLessThanOrEqual(0.9);
  });

  it("multi-factor: merges duplicates from different factors before MMR", () => {
    const chunks = [
      makeChunk("a.ts", 1, 0.9, "internal mechanism", V_A, [{ id: "internal", score: 0.9 }]),
      makeChunk("a.ts", 1, 0.7, "internal mechanism", V_A, [{ id: "risk", score: 0.7 }]),
      makeChunk("b.ts", 1, 0.8, "technology innovation", V_B, [{ id: "technology", score: 0.8 }]),
    ];
    const result = applyDiversityPipeline({
      chunks,
      budgetTokens: 10000,
      threshold: 0.5,
      thresholdFloor: 0.3,
      mmrLambda: 0.7,
    });
    // a.ts:1 should be merged into one chunk
    const aPaths = result.chunks.filter((c) => c.path === "a.ts");
    expect(aPaths).toHaveLength(1);
    expect(aPaths[0].score).toBe(0.9);
    // Should have both factor attributions
    const factorIds = aPaths[0].factorsUsed?.map((f) => f.id) ?? [];
    expect(factorIds).toContain("internal");
    expect(factorIds).toContain("risk");
  });
});
