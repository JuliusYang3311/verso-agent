#!/usr/bin/env npx tsx
/**
 * ingest-style.ts
 * Ingest style corpus files into the novel-writer style memory DB.
 * Replaces scripts/ingest.py for the style library.
 *
 * Usage:
 *   npx tsx skills/novel-writer/ts/ingest-style.ts \
 *     --source-dir ./corpus --glob "**\/*.txt" \
 *     --author "Author" --genre "Fantasy" --tags "dark,gothic"
 */

import { globSync } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { STYLE_DB_PATH } from "./apply-patch.js";
import { NovelMemoryStore } from "./novel-memory.js";

function chunkByChars(text: string, minChars: number, maxChars: number): string[] {
  const cleaned = text.trim().replace(/\r/g, "");
  if (!cleaned) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(cleaned.length, start + maxChars);
    const chunk = cleaned.slice(start, end).trim();
    if (chunk.length < minChars && end < cleaned.length) {
      end = Math.min(cleaned.length, start + minChars);
    }
    const final = cleaned.slice(start, end).trim();
    if (final) chunks.push(final);
    start = end;
  }
  return chunks;
}

function buildMetadataHeader(meta: Record<string, string | string[]>): string {
  const lines: string[] = ["---"];
  for (const [key, val] of Object.entries(meta)) {
    if (!val || (Array.isArray(val) && val.length === 0)) continue;
    const value = Array.isArray(val) ? val.join(", ") : val;
    if (value) lines.push(`${key}: ${value}`);
  }
  lines.push("---\n");
  return lines.length > 2 ? lines.join("\n") : "";
}

async function main() {
  const { values } = parseArgs({
    options: {
      "source-dir": { type: "string" },
      glob: { type: "string", default: "**/*.txt" },
      "min-chars": { type: "string", default: "500" },
      "max-chars": { type: "string", default: "1200" },
      author: { type: "string", default: "" },
      genre: { type: "string", default: "" },
      pov: { type: "string", default: "" },
      rhythm: { type: "string", default: "" },
      tone: { type: "string", default: "" },
      tags: { type: "string", default: "" },
      force: { type: "boolean", default: false },
    },
    strict: true,
  });

  const sourceDir = values["source-dir"];
  if (!sourceDir) {
    console.error("--source-dir is required");
    process.exit(1);
  }

  const resolvedDir = path.resolve(sourceDir);
  if (!fsSync.existsSync(resolvedDir)) {
    console.error(`source directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  const pattern = values.glob!;
  const minChars = parseInt(values["min-chars"]!, 10);
  const maxChars = parseInt(values["max-chars"]!, 10);
  const tags = values.tags
    ? values.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const meta = {
    author: values.author!,
    genre: values.genre!,
    pov: values.pov!,
    rhythm: values.rhythm!,
    tone: values.tone!,
    tags,
  };

  // Find files
  const files = globSync(pattern, { cwd: resolvedDir }).map((f) => path.resolve(resolvedDir, f));
  if (files.length === 0) {
    console.error(`no files matched pattern "${pattern}" in ${resolvedDir}`);
    process.exit(1);
  }

  console.error(`Found ${files.length} files, opening style DB...`);

  const store = await NovelMemoryStore.open({
    dbPath: STYLE_DB_PATH,
    source: "style",
  });

  let totalChunks = 0;
  let skipped = 0;

  for (const filePath of files) {
    const text = fsSync.readFileSync(filePath, "utf-8");
    const chunks = chunkByChars(text, minChars, maxChars);
    const relPath = path.relative(resolvedDir, filePath);

    for (let i = 0; i < chunks.length; i++) {
      const header = buildMetadataHeader(meta);
      const content = header + chunks[i]!;
      const virtualPath = `style/${relPath}/${i}`;

      const result = await store.indexContent({
        virtualPath,
        content,
        force: values.force,
      });

      if (result.skipped) {
        skipped++;
      } else {
        totalChunks += result.chunks;
      }
    }

    console.error(`  ${relPath}: ${chunks.length} chunks`);
  }

  const stats = store.stats();
  store.close();

  const output = {
    status: "ok",
    backend: "verso-memory",
    db: STYLE_DB_PATH,
    filesProcessed: files.length,
    chunksIndexed: totalChunks,
    chunksSkipped: skipped,
    totalFiles: stats.files,
    totalChunks: stats.chunks,
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
