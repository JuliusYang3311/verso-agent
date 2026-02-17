/**
 * manager-l1-generator.ts
 * Background L1 overview generator for memory chunks.
 * Supports two modes:
 *   - Heuristic (default): extract headings + first sentences + key entities (~2000 chars)
 *   - LLM (opt-in via l1UseLlm): use the session's LLM to generate structured summaries
 *
 * Designed to be memory-safe:
 *   - Bounded queue with max pending items
 *   - Rate-limited LLM calls
 *   - Timer auto-cleanup on close
 */

import type { DatabaseSync } from "node:sqlite";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("memory");

const L1_MAX_CHARS = 2000;
const MAX_PENDING = 200;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_INTERVAL_MS = 5_000;

type PendingChunk = {
  chunkId: string;
  text: string;
  path: string;
};

export type L1LlmInvoker = (prompt: string) => Promise<string>;

export type L1GeneratorConfig = {
  db: DatabaseSync;
  useLlm: boolean;
  llmRateLimitMs: number;
  llmInvoker?: L1LlmInvoker;
};

/**
 * Generate an L1 overview using heuristic extraction (no LLM).
 * Extracts headings, first sentences of each section, and code block annotations.
 */
export function generateL1Heuristic(text: string): string {
  const lines = text.split("\n");
  const parts: string[] = [];
  let totalChars = 0;

  for (let i = 0; i < lines.length && totalChars < L1_MAX_CHARS; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line) {
      continue;
    }

    // Always include headings
    if (line.startsWith("#")) {
      const heading = line
        .replace(/^#+\s*/, "")
        .replace(/[*_`[\]]/g, "")
        .trim();
      if (heading) {
        parts.push(heading);
        totalChars += heading.length;
      }
      continue;
    }

    // Include first non-empty line after a heading or blank line
    const prevLine = i > 0 ? (lines[i - 1] ?? "").trim() : "";
    if (!prevLine || prevLine.startsWith("#")) {
      const cleaned = line.replace(/[*_`[\]]/g, "").trim();
      const dotIdx = cleaned.indexOf(".");
      const sentence = dotIdx >= 0 ? cleaned.slice(0, dotIdx + 1) : cleaned;
      if (sentence && sentence.length > 10) {
        parts.push(sentence);
        totalChars += sentence.length;
      }
    }
  }

  if (parts.length === 0) {
    // Fallback: first 2000 chars stripped of markdown
    return text
      .replace(/[*_`#[\]]/g, "")
      .trim()
      .slice(0, L1_MAX_CHARS);
  }

  const combined = parts.join(" ");
  return combined.length > L1_MAX_CHARS ? combined.slice(0, L1_MAX_CHARS) : combined;
}

export class L1BackgroundGenerator {
  private pending: PendingChunk[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastLlmCallMs = 0;
  private closed = false;
  private config: L1GeneratorConfig;

  constructor(config: L1GeneratorConfig) {
    this.config = config;
  }

  enqueue(chunkId: string, text: string, path: string): void {
    if (this.closed) {
      return;
    }
    // Bounded queue to prevent memory leaks
    if (this.pending.length >= MAX_PENDING) {
      this.pending.shift();
    }
    this.pending.push({ chunkId, text, path });
    this.ensureTimer();
  }

  close(): void {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pending = [];
  }

  private ensureTimer(): void {
    if (this.timer || this.closed) {
      return;
    }
    this.timer = setInterval(() => {
      void this.processBatch().catch((err) => {
        log.debug(`L1 background generation failed: ${String(err)}`);
      });
    }, DEFAULT_INTERVAL_MS);
    this.timer.unref?.();
  }

  private async processBatch(): Promise<void> {
    if (this.pending.length === 0) {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      return;
    }

    const batch = this.pending.splice(0, DEFAULT_BATCH_SIZE);

    for (const item of batch) {
      if (this.closed) {
        return;
      }
      try {
        let overview: string;
        if (this.config.useLlm && this.config.llmInvoker) {
          // Rate-limit LLM calls
          const now = Date.now();
          const elapsed = now - this.lastLlmCallMs;
          if (elapsed < this.config.llmRateLimitMs) {
            await new Promise((r) => setTimeout(r, this.config.llmRateLimitMs - elapsed));
          }
          this.lastLlmCallMs = Date.now();

          const prompt =
            `Summarize the following text in a structured overview (max 500 tokens). ` +
            `Include key topics, entities, and conclusions:\n\n${item.text.slice(0, 4000)}`;
          overview = await this.config.llmInvoker(prompt);
          if (overview.length > L1_MAX_CHARS) {
            overview = overview.slice(0, L1_MAX_CHARS);
          }
        } else {
          overview = generateL1Heuristic(item.text);
        }

        // Write L1 to database
        this.config.db
          .prepare(`UPDATE chunks SET l1_overview = ?, l1_status = 'done' WHERE id = ?`)
          .run(overview, item.chunkId);
      } catch (err) {
        log.debug(`L1 generation failed for chunk ${item.chunkId}: ${String(err)}`);
        try {
          this.config.db
            .prepare(`UPDATE chunks SET l1_status = 'error' WHERE id = ?`)
            .run(item.chunkId);
        } catch {
          // ignore DB errors during error handling
        }
      }
    }
  }
}
