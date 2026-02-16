/**
 * manager-batch.ts
 * Batch embedding orchestration for MemoryIndexManager.
 * Consolidates the per-provider batch methods (OpenAI, Gemini, Voyage)
 * into a single generic flow.
 * Extracted from manager.ts to reduce file size and eliminate repetition.
 */

import type { DatabaseSync } from "node:sqlite";
import type { MemoryChunk } from "./internal.js";
import type { MemorySource } from "./types.js";
import { hashText } from "./internal.js";
import {
  loadEmbeddingCache,
  upsertEmbeddingCache,
  type EmbeddingCacheConfig,
  type EmbeddingProviderInfo,
} from "./manager-embedding-cache.js";

export type BatchConfig = {
  enabled: boolean;
  wait: boolean;
  concurrency: number;
  pollIntervalMs: number;
  timeoutMs: number;
};

export type BatchFailureState = {
  count: number;
  lastError?: string;
  lastProvider?: string;
};

export type FileEntryRef = {
  path: string;
};

/**
 * Generic batch embedding flow for any provider.
 * Takes a `createRequests` function to build provider-specific requests
 * and a `runBatch` function to execute them.
 */
export async function embedChunksWithProviderBatch<TRequest>(params: {
  chunks: MemoryChunk[];
  entry: FileEntryRef;
  source: MemorySource;
  db: DatabaseSync;
  cache: EmbeddingCacheConfig;
  provider: EmbeddingProviderInfo;
  providerKey: string;
  cacheTable: string;
  /** Build provider-specific batch requests for the missing chunks. */
  createRequests: (
    missing: Array<{ index: number; chunk: MemoryChunk }>,
    mapping: Map<string, { index: number; hash: string }>,
  ) => TRequest[];
  /** Run the batch and return a map of customId → embedding. */
  runBatch: (requests: TRequest[]) => Promise<Map<string, number[]>>;
  /** Fallback to non-batch embedding if batch is disabled/fails. */
  nonBatchFallback: (chunks: MemoryChunk[]) => Promise<number[][]>;
  /** Run batch with fallback wrapper (handles failure counting). */
  runBatchWithFallback: <T>(p: {
    provider: string;
    run: () => Promise<T>;
    fallback: () => Promise<number[][]>;
  }) => Promise<T | number[][]>;
}): Promise<number[][]> {
  if (params.chunks.length === 0) {
    return [];
  }
  const cached = loadEmbeddingCache({
    db: params.db,
    cache: params.cache,
    provider: params.provider,
    providerKey: params.providerKey,
    cacheTable: params.cacheTable,
    hashes: params.chunks.map((chunk) => chunk.hash),
  });
  const embeddings: number[][] = Array.from({ length: params.chunks.length }, () => []);
  const missing: Array<{ index: number; chunk: MemoryChunk }> = [];

  for (let i = 0; i < params.chunks.length; i += 1) {
    const chunk = params.chunks[i];
    const hit = chunk?.hash ? cached.get(chunk.hash) : undefined;
    if (hit && hit.length > 0) {
      embeddings[i] = hit;
    } else if (chunk) {
      missing.push({ index: i, chunk });
    }
  }

  if (missing.length === 0) {
    return embeddings;
  }

  const mapping = new Map<string, { index: number; hash: string }>();
  for (const item of missing) {
    const chunk = item.chunk;
    const customId = hashText(
      `${params.source}:${params.entry.path}:${chunk.startLine}:${chunk.endLine}:${chunk.hash}:${item.index}`,
    );
    mapping.set(customId, { index: item.index, hash: chunk.hash });
  }

  const requests = params.createRequests(missing, mapping);
  const batchResult = await params.runBatchWithFallback({
    provider: params.provider.id,
    run: async () => params.runBatch(requests),
    fallback: async () => await params.nonBatchFallback(params.chunks),
  });
  if (Array.isArray(batchResult)) {
    return batchResult;
  }
  const byCustomId = batchResult;

  const toCache: Array<{ hash: string; embedding: number[] }> = [];
  for (const [customId, embedding] of byCustomId.entries()) {
    const mapped = mapping.get(customId);
    if (!mapped) {
      continue;
    }
    embeddings[mapped.index] = embedding;
    toCache.push({ hash: mapped.hash, embedding });
  }
  upsertEmbeddingCache({
    db: params.db,
    cache: params.cache,
    provider: params.provider,
    providerKey: params.providerKey,
    cacheTable: params.cacheTable,
    entries: toCache,
  });
  return embeddings;
}
