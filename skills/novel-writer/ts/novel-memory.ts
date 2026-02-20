/**
 * novel-memory.ts
 * Core memory bridge for novel-writer skill.
 * Creates isolated SQLite DBs with verso's full memory schema
 * (files/chunks/vec/fts/L0/L1/embedding_cache) and exposes
 * index + search operations that reuse verso's primitives.
 */

import type { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { EmbeddingProvider, EmbeddingProviderResult } from "../../../src/memory/embeddings.js";
import type { MemoryChunk } from "../../../src/memory/internal.js";
import type { EmbeddingContext } from "../../../src/memory/manager-embeddings.js";
import type { SearchRowResult } from "../../../src/memory/manager-search.js";
import type { VectorState } from "../../../src/memory/manager-vectors.js";
import { DEFAULT_CONTEXT_PARAMS } from "../../../src/agents/dynamic-context.js";
import { loadConfig } from "../../../src/config/io.js";
import { createEmbeddingProvider } from "../../../src/memory/embeddings.js";
import { bm25RankToScore, buildFtsQuery, mergeHybridResults } from "../../../src/memory/hybrid.js";
import {
  chunkMarkdown,
  generateL0Abstract,
  generateFileL0,
  hashText,
  ensureDir,
} from "../../../src/memory/internal.js";
import {
  createBatchFailureTracker,
  runBatchWithFallback,
} from "../../../src/memory/manager-batch-failure.js";
import {
  embedChunksInBatches,
  embedQueryWithTimeout,
  computeProviderKey,
  withTimeout,
} from "../../../src/memory/manager-embeddings.js";
import { searchHierarchical } from "../../../src/memory/manager-hierarchical-search.js";
import { searchVector, searchKeyword } from "../../../src/memory/manager-search.js";
import {
  VECTOR_TABLE,
  FILES_VECTOR_TABLE,
  loadVectorExtension,
  ensureVectorTable,
  ensureFileVectorTable,
  vectorToBlob,
} from "../../../src/memory/manager-vectors.js";
import { ensureMemoryIndexSchema } from "../../../src/memory/memory-schema.js";
import { requireNodeSqlite } from "../../../src/memory/sqlite.js";

const FTS_TABLE = "chunks_fts";
const EMBEDDING_CACHE_TABLE = "embedding_cache";
const META_KEY = "novel_memory_meta_v1";
const SNIPPET_MAX_CHARS = 700;
const VECTOR_LOAD_TIMEOUT_MS = 30_000;

type NovelMemoryMeta = {
  model: string;
  provider: string;
  providerKey: string;
  chunkTokens: number;
  chunkOverlap: number;
  vectorDims?: number;
};

export type NovelMemoryConfig = {
  dbPath: string;
  source: string;
  chunking?: { tokens: number; overlap: number };
  vectorEnabled?: boolean;
  vectorExtensionPath?: string;
  ftsEnabled?: boolean;
  cacheEnabled?: boolean;
};

export class NovelMemoryStore {
  private db: DatabaseSync;
  private provider: EmbeddingProvider;
  private providerKey: string;
  private providerResult: EmbeddingProviderResult;
  private vector: VectorState;
  private vectorReady: Promise<boolean> | null = null;
  private fileVectorTableReady = false;
  private fts: { enabled: boolean; available: boolean };
  private filesFts: { available: boolean };
  private cache: { enabled: boolean };
  private source: string;
  private chunking: { tokens: number; overlap: number };
  private batchFailureTracker;

  private constructor(params: {
    db: DatabaseSync;
    providerResult: EmbeddingProviderResult;
    config: NovelMemoryConfig;
    ftsAvailable: boolean;
    filesFtsAvailable: boolean;
  }) {
    this.db = params.db;
    this.providerResult = params.providerResult;
    this.provider = params.providerResult.provider;
    this.providerKey = computeProviderKey(
      this.provider,
      params.providerResult.openAi,
      params.providerResult.gemini,
    );
    this.source = params.config.source;
    this.chunking = params.config.chunking ?? { tokens: 400, overlap: 80 };
    this.cache = { enabled: params.config.cacheEnabled !== false };
    this.fts = {
      enabled: params.config.ftsEnabled !== false,
      available: params.ftsAvailable,
    };
    this.filesFts = { available: params.filesFtsAvailable };
    this.vector = {
      enabled: params.config.vectorEnabled !== false,
      available: null,
      extensionPath: params.config.vectorExtensionPath,
    };
    this.batchFailureTracker = createBatchFailureTracker(false);
  }

  static async open(config: NovelMemoryConfig): Promise<NovelMemoryStore> {
    const dir = path.dirname(config.dbPath);
    ensureDir(dir);

    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(config.dbPath, {
      allowExtension: config.vectorEnabled !== false,
    });

    const { ftsAvailable, filesFtsAvailable } = ensureMemoryIndexSchema({
      db,
      embeddingCacheTable: EMBEDDING_CACHE_TABLE,
      ftsTable: FTS_TABLE,
      ftsEnabled: config.ftsEnabled !== false,
    });

    const providerResult = await resolveEmbeddingProvider();

    const store = new NovelMemoryStore({
      db,
      providerResult,
      config,
      ftsAvailable,
      filesFtsAvailable,
    });

    // Read existing meta for vector dims
    const meta = store.readMeta();
    if (meta?.vectorDims) {
      store.vector.dims = meta.vectorDims;
    }

    return store;
  }

  /**
   * Index a piece of content (style chunk, timeline entry, etc.) as a virtual "file".
   * The content is chunked, embedded, and stored with L0 abstracts.
   */
  async indexContent(params: {
    /** Virtual path identifier (e.g. "style/author-chapter-1" or "timeline/entry-42") */
    virtualPath: string;
    /** The text content to index */
    content: string;
    /** Force re-index even if hash matches */
    force?: boolean;
  }): Promise<{ chunks: number; skipped: boolean }> {
    const contentHash = hashText(params.content);

    // Check if already indexed with same hash
    if (!params.force) {
      const existing = this.db
        .prepare(`SELECT hash FROM files WHERE path = ? AND source = ?`)
        .get(params.virtualPath, this.source) as { hash: string } | undefined;
      if (existing?.hash === contentHash) {
        return { chunks: 0, skipped: true };
      }
    }

    const chunks = chunkMarkdown(params.content, this.chunking).filter(
      (c) => c.text.trim().length > 0,
    );
    if (chunks.length === 0) {
      return { chunks: 0, skipped: false };
    }

    const ctx = this.buildEmbeddingContext();
    const embeddings = await embedChunksInBatches(ctx, chunks);
    const sample = embeddings.find((e) => e.length > 0);
    const vectorReady = sample ? await this.ensureVectorReady(sample.length) : false;
    const now = Date.now();

    // Generate L0 abstracts
    const chunkL0s = chunks.map((c) => generateL0Abstract(c));

    // Clean old data for this path
    if (vectorReady) {
      try {
        this.db
          .prepare(
            `DELETE FROM ${VECTOR_TABLE} WHERE id IN (SELECT id FROM chunks WHERE path = ? AND source = ?)`,
          )
          .run(params.virtualPath, this.source);
      } catch {}
    }
    if (this.fts.enabled && this.fts.available) {
      try {
        this.db
          .prepare(`DELETE FROM ${FTS_TABLE} WHERE path = ? AND source = ? AND model = ?`)
          .run(params.virtualPath, this.source, this.provider.model);
      } catch {}
    }
    this.db
      .prepare(`DELETE FROM chunks WHERE path = ? AND source = ?`)
      .run(params.virtualPath, this.source);

    // Insert chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const embedding = embeddings[i] ?? [];
      const l0 = chunkL0s[i] ?? "";
      const id = hashText(
        `${this.source}:${params.virtualPath}:${chunk.startLine}:${chunk.endLine}:${chunk.hash}:${this.provider.model}`,
      );

      this.db
        .prepare(
          `INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at, l0_abstract)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             hash=excluded.hash, model=excluded.model, text=excluded.text,
             embedding=excluded.embedding, updated_at=excluded.updated_at,
             l0_abstract=excluded.l0_abstract`,
        )
        .run(
          id,
          params.virtualPath,
          this.source,
          chunk.startLine,
          chunk.endLine,
          chunk.hash,
          this.provider.model,
          chunk.text,
          JSON.stringify(embedding),
          now,
          l0,
        );

      if (vectorReady && embedding.length > 0) {
        try {
          this.db.prepare(`DELETE FROM ${VECTOR_TABLE} WHERE id = ?`).run(id);
        } catch {}
        this.db
          .prepare(`INSERT INTO ${VECTOR_TABLE} (id, embedding) VALUES (?, ?)`)
          .run(id, vectorToBlob(embedding));
      }

      if (this.fts.enabled && this.fts.available) {
        this.db
          .prepare(
            `INSERT INTO ${FTS_TABLE} (text, id, path, source, model, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            chunk.text,
            id,
            params.virtualPath,
            this.source,
            this.provider.model,
            chunk.startLine,
            chunk.endLine,
          );
      }
    }

    // File-level L0
    const fileL0 = generateFileL0(chunkL0s);
    let fileL0Embedding: number[] = [];
    if (fileL0 && vectorReady && sample) {
      try {
        fileL0Embedding = await embedQueryWithTimeout(ctx, fileL0);
      } catch {}
      if (fileL0Embedding.length > 0) {
        if (!this.fileVectorTableReady) {
          this.fileVectorTableReady = ensureFileVectorTable(this.db, fileL0Embedding.length);
        }
        if (this.fileVectorTableReady) {
          try {
            this.db
              .prepare(`DELETE FROM ${FILES_VECTOR_TABLE} WHERE path = ?`)
              .run(params.virtualPath);
          } catch {}
          try {
            this.db
              .prepare(`INSERT INTO ${FILES_VECTOR_TABLE} (path, embedding) VALUES (?, ?)`)
              .run(params.virtualPath, vectorToBlob(fileL0Embedding));
          } catch {}
        }
      }
    }

    // Write to files_fts
    if (fileL0 && this.filesFts.available) {
      try {
        this.db.prepare(`DELETE FROM files_fts WHERE path = ?`).run(params.virtualPath);
      } catch {}
      try {
        this.db
          .prepare(`INSERT INTO files_fts (l0_abstract, path, source) VALUES (?, ?, ?)`)
          .run(fileL0, params.virtualPath, this.source);
      } catch {}
    }

    // Upsert file record
    this.db
      .prepare(
        `INSERT INTO files (path, source, hash, mtime, size, l0_abstract, l0_embedding) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           source=excluded.source, hash=excluded.hash, mtime=excluded.mtime,
           size=excluded.size, l0_abstract=excluded.l0_abstract, l0_embedding=excluded.l0_embedding`,
      )
      .run(
        params.virtualPath,
        this.source,
        contentHash,
        now,
        params.content.length,
        fileL0,
        JSON.stringify(fileL0Embedding),
      );

    // Write meta
    this.writeMeta({
      model: this.provider.model,
      provider: this.provider.id,
      providerKey: this.providerKey,
      chunkTokens: this.chunking.tokens,
      chunkOverlap: this.chunking.overlap,
      vectorDims: this.vector.dims,
    });

    return { chunks: chunks.length, skipped: false };
  }

  /**
   * Search the index using hierarchical search with hybrid (vector + FTS).
   */
  async search(params: {
    query: string;
    limit?: number;
    minScore?: number;
  }): Promise<SearchRowResult[]> {
    const query = params.query.trim();
    if (!query) return [];
    const limit = params.limit ?? 6;
    const minScore = params.minScore ?? 0.3;

    const ctx = this.buildEmbeddingContext();
    const queryVec = await embedQueryWithTimeout(ctx, query);
    const hasVector = queryVec.some((v) => v !== 0);

    const sourceFilter = this.buildSourceFilter();
    const sourceFilterAliased = this.buildSourceFilter("c");

    // Try hierarchical search first
    if (hasVector) {
      try {
        const results = await searchHierarchical({
          db: this.db,
          queryVec,
          query,
          limit: Math.min(200, limit * 4),
          snippetMaxChars: SNIPPET_MAX_CHARS,
          providerModel: this.provider.model,
          vectorTable: VECTOR_TABLE,
          filesVectorTable: FILES_VECTOR_TABLE,
          filesFtsTable: "files_fts",
          ftsAvailable: this.fts.available,
          filesFtsAvailable: this.filesFts.available,
          contextParams: DEFAULT_CONTEXT_PARAMS,
          ensureVectorReady: async (dims) => this.ensureVectorReady(dims),
          ensureFileVectorReady: async (dims) => {
            const ready = await this.ensureVectorReady(dims);
            if (ready && !this.fileVectorTableReady) {
              this.fileVectorTableReady = ensureFileVectorTable(this.db, dims);
            }
            return ready && this.fileVectorTableReady;
          },
          sourceFilterVec: sourceFilterAliased,
          sourceFilterChunks: sourceFilter,
        });

        return results.filter((r) => r.score >= minScore).slice(0, limit);
      } catch {
        // Fall through to flat search
      }
    }

    // Flat fallback
    const vectorResults = hasVector
      ? await searchVector({
          db: this.db,
          vectorTable: VECTOR_TABLE,
          providerModel: this.provider.model,
          queryVec,
          limit: limit * 4,
          snippetMaxChars: SNIPPET_MAX_CHARS,
          ensureVectorReady: async (dims) => this.ensureVectorReady(dims),
          sourceFilterVec: sourceFilterAliased,
          sourceFilterChunks: sourceFilter,
        }).catch(() => [])
      : [];

    if (!this.fts.available) {
      return vectorResults.filter((r) => r.score >= minScore).slice(0, limit);
    }

    const keywordResults = await searchKeyword({
      db: this.db,
      ftsTable: FTS_TABLE,
      providerModel: this.provider.model,
      query,
      limit: limit * 4,
      snippetMaxChars: SNIPPET_MAX_CHARS,
      sourceFilter,
      buildFtsQuery: (raw) => buildFtsQuery(raw),
      bm25RankToScore,
    }).catch(() => []);

    if (keywordResults.length === 0) {
      return vectorResults.filter((r) => r.score >= minScore).slice(0, limit);
    }

    const merged = mergeHybridResults({
      vector: vectorResults.map((r) => ({
        id: r.id,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        snippet: r.snippet,
        vectorScore: r.score,
        timestamp: r.timestamp,
      })),
      keyword: keywordResults.map((r) => ({
        id: r.id,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        snippet: r.snippet,
        textScore: r.textScore,
      })),
      vectorWeight: 0.7,
      textWeight: 0.3,
    });

    return merged.filter((r) => r.score >= minScore).slice(0, limit);
  }

  /** Get stats about the index. */
  stats(): { files: number; chunks: number } {
    const files = (
      this.db.prepare(`SELECT COUNT(*) as c FROM files WHERE source = ?`).get(this.source) as {
        c: number;
      }
    ).c;
    const chunks = (
      this.db.prepare(`SELECT COUNT(*) as c FROM chunks WHERE source = ?`).get(this.source) as {
        c: number;
      }
    ).c;
    return { files, chunks };
  }

  /** Remove all indexed data for a virtual path. */
  removePath(virtualPath: string): void {
    try {
      this.db
        .prepare(
          `DELETE FROM ${VECTOR_TABLE} WHERE id IN (SELECT id FROM chunks WHERE path = ? AND source = ?)`,
        )
        .run(virtualPath, this.source);
    } catch {}
    if (this.fts.available) {
      try {
        this.db
          .prepare(`DELETE FROM ${FTS_TABLE} WHERE path = ? AND source = ?`)
          .run(virtualPath, this.source);
      } catch {}
    }
    this.db
      .prepare(`DELETE FROM chunks WHERE path = ? AND source = ?`)
      .run(virtualPath, this.source);
    this.db
      .prepare(`DELETE FROM files WHERE path = ? AND source = ?`)
      .run(virtualPath, this.source);
    try {
      this.db.prepare(`DELETE FROM ${FILES_VECTOR_TABLE} WHERE path = ?`).run(virtualPath);
    } catch {}
    try {
      this.db.prepare(`DELETE FROM files_fts WHERE path = ?`).run(virtualPath);
    } catch {}
  }

  close(): void {
    this.db.close();
  }

  // --- Private helpers ---

  private buildSourceFilter(alias?: string): { sql: string; params: string[] } {
    const col = alias ? `${alias}.source` : "source";
    return { sql: ` AND ${col} = ?`, params: [this.source] };
  }

  private buildEmbeddingContext(): EmbeddingContext {
    return {
      db: this.db,
      provider: this.provider,
      providerKey: this.providerKey,
      cache: this.cache,
      cacheTable: EMBEDDING_CACHE_TABLE,
      batch: {
        enabled: false,
        wait: false,
        concurrency: 1,
        pollIntervalMs: 2000,
        timeoutMs: 60_000,
      },
      openAi: this.providerResult.openAi,
      gemini: this.providerResult.gemini,
      voyage: this.providerResult.voyage,
      agentId: "novel-writer",
      runBatchWithFallback: async <T>(p: {
        provider: string;
        run: () => Promise<T>;
        fallback: () => Promise<number[][]>;
      }) => runBatchWithFallback(this.batchFailureTracker, p),
    };
  }

  private async ensureVectorReady(dimensions?: number): Promise<boolean> {
    if (!this.vector.enabled) return false;
    if (!this.vectorReady) {
      this.vectorReady = withTimeout(
        loadVectorExtension(this.db, this.vector),
        VECTOR_LOAD_TIMEOUT_MS,
        `sqlite-vec load timed out`,
      );
    }
    let ready = false;
    try {
      ready = await this.vectorReady;
    } catch {
      this.vector.available = false;
      this.vectorReady = null;
      return false;
    }
    if (ready && typeof dimensions === "number" && dimensions > 0) {
      ensureVectorTable(this.db, this.vector, dimensions);
    }
    return ready;
  }

  private readMeta(): NovelMemoryMeta | null {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = ?`).get(META_KEY) as
      | { value: string }
      | undefined;
    if (!row?.value) return null;
    try {
      return JSON.parse(row.value) as NovelMemoryMeta;
    } catch {
      return null;
    }
  }

  private writeMeta(meta: NovelMemoryMeta): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      )
      .run(META_KEY, JSON.stringify(meta));
  }
}

// --- Embedding provider resolution ---

async function resolveEmbeddingProvider(): Promise<EmbeddingProviderResult> {
  let cfg;
  try {
    cfg = loadConfig();
  } catch {
    cfg = {} as any;
  }

  // Try to get provider settings from verso config
  const memSearch = cfg?.agents?.defaults?.memorySearch;
  const provider = memSearch?.provider ?? "auto";
  const model = memSearch?.model ?? "";
  const fallback = memSearch?.fallback ?? "none";
  const remote = memSearch?.remote;
  const local = memSearch?.local;

  return createEmbeddingProvider({
    config: cfg,
    provider: provider as any,
    model,
    fallback: fallback as any,
    remote,
    local,
  });
}
