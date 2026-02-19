---
name: novel-writer
description: Create and maintain long-form serialized fiction with a shared style library and per-project four-layer continuity memory. Ingest authorized corpora for style indexing, generate chapters from outlines, auto-update character/world/timeline/plot-thread memory after each chapter, and optionally save to Google Docs.
---

# Novel Writer

## Overview

Style-aware, continuity-safe fiction pipeline: ingest corpus → index style → write chapters from outline → auto-update four-layer story memory → optionally save to Google Docs.

All scripts are in `skills/novel-writer/ts/` and run via `npx tsx`. Embedding and vector search are powered by verso's memory infrastructure (sqlite-vec, FTS5, hierarchical search, embedding cache).

## Architecture

```
skills/novel-writer/
├── ts/                         # TypeScript scripts (verso-backed)
│   ├── novel-memory.ts         # Core: isolated SQLite DBs with verso's memory schema
│   ├── ingest-style.ts         # Ingest style corpus → shared style DB
│   ├── ingest-timeline.ts      # Bulk re-index timeline.jsonl → per-project timeline DB
│   ├── search.ts               # Search style or timeline DB
│   ├── context.ts              # Assemble full context (JSON memory + search results)
│   ├── apply-patch.ts          # Apply patch + auto-index timeline (main entry point)
│   ├── validate-patch.ts       # Validate patch before applying
│   ├── extract-updates.ts      # LLM-based patch extraction from chapter text
│   └── status.ts               # Show project progress
├── scripts/                    # Legacy Python scripts (deprecated, still functional)
├── references/
│   ├── memory_schema.md        # JSON schemas for 4-layer memory
│   ├── style_tags.md           # Allowed tags + style taxonomy
│   └── doc_naming.md           # Google Docs naming rules
├── style/                      # SHARED style DB (all projects)
│   └── style_memory.sqlite     # Verso-backed style index
└── projects/<project>/         # PER-PROJECT isolation
    ├── state.json              # Progress tracking
    ├── memory/
    │   ├── characters.json
    │   ├── world_bible.json
    │   ├── plot_threads.json
    │   └── timeline.jsonl
    ├── timeline_memory.sqlite  # Verso-backed timeline index (auto-updated)
    ├── chapters/               # Chapter text files
    └── style/
        └── default_style.json  # Per-project default tags
```

## Storage Isolation Rules

| Storage                                     | Scope                 | Updated by                                        |
| ------------------------------------------- | --------------------- | ------------------------------------------------- |
| `style/style_memory.sqlite`                 | Shared (all projects) | `ingest-style.ts` only (manual ingest)            |
| `projects/<project>/memory/*.json`          | Per-project           | `apply-patch.ts` (after each chapter)             |
| `projects/<project>/memory/timeline.jsonl`  | Per-project           | `apply-patch.ts` (append after each chapter)      |
| `projects/<project>/timeline_memory.sqlite` | Per-project           | `apply-patch.ts` (auto-index after each chapter)  |
| `projects/<project>/state.json`             | Per-project           | `apply-patch.ts` (auto-update after each chapter) |

Key rules:

- Style library is **never** modified by chapter writes. Only `ingest-style.ts` adds content.
- Each project's memory is **completely isolated**. No cross-project contamination.
- Timeline DB is **automatically re-indexed** every time `apply-patch.ts` runs.

## Core Workflow

### 1. Create a New Project

Simply use `--project <name>` on any command. Directories are created automatically.

```bash
npx tsx skills/novel-writer/ts/status.ts --project my_novel
```

### 2. Ingest Style Corpus (One-Time, Shared)

Ingest authorized reference texts into the shared style library. This is the **only** way to add style content.

```bash
npx tsx skills/novel-writer/ts/ingest-style.ts \
  --source-dir /path/to/corpus \
  --glob "**/*.txt" \
  --author "Author Name" \
  --genre "悬疑" \
  --tags "noir,快节奏"
```

Options:

- `--source-dir` (required): directory containing source text files
- `--glob`: file pattern (default: `**/*.txt`)
- `--min-chars` / `--max-chars`: chunk size bounds (default: 500/1200)
- `--author`, `--genre`, `--pov`, `--rhythm`, `--tone`: style metadata
- `--tags`: comma-separated tags for filtering
- `--force`: re-index even if content hash matches

Metadata is embedded as a YAML header in each chunk, making it searchable via both vector and FTS.

### 3. Set Per-Project Default Style Tags

Create `projects/<project>/style/default_style.json`:

```json
{
  "tags": ["悬疑", "快节奏", "noir"]
}
```

These tags are automatically applied as filters during context retrieval.

### 4. Retrieve Context Before Writing

Load full context (4-layer memory + style snippets + timeline hits) for the agent:

```bash
npx tsx skills/novel-writer/ts/context.ts \
  --project my_novel \
  --outline "第8章：林澈在旧港码头发现暗门" \
  --style "noir 悬疑 紧张氛围" \
  --recent 5 \
  --limit 5
```

Returns:

```json
{
  "status": "ok",
  "project": "my_novel",
  "state": { "last_chapter": 7, ... },
  "characters": { "characters": [...] },
  "world_bible": { "world": {...}, "protected_keys": [...] },
  "plot_threads": { "threads": [...] },
  "timeline_recent": [ /* last N timeline entries */ ],
  "timeline_hits": [ /* semantic search results from timeline DB */ ],
  "style_snippets": [ /* semantic search results from style DB */ ],
  "default_style": { "tags": [...] }
}
```

- `--outline` drives semantic retrieval for both style and timeline
- `--style` adds additional search terms for style retrieval
- `--recent N` returns the last N timeline entries (tail read, no search)
- `--limit N` controls max search results per DB

### 5. Write Chapter

The agent writes the chapter using the retrieved context. Save the chapter text to a file.

**Minimum length: 5000 words per chapter.** This is a hard requirement — every chapter must be at least 5000 words. If the draft is shorter, continue writing until the minimum is met before proceeding to memory extraction.

### 6. Extract Memory Updates from Chapter

Use an LLM to extract a structured patch from the chapter text:

```bash
npx tsx skills/novel-writer/ts/extract-updates.ts \
  --project my_novel \
  --chapter 8 \
  --title "回响" \
  --text chapters/chapter-08.txt > patch.json
```

Env vars for LLM:

- `NOVEL_LLM_BASE_URL` / `OPENAI_BASE_URL` (default: `https://api.openai.com/v1`)
- `NOVEL_LLM_API_KEY` / `OPENAI_API_KEY`
- `NOVEL_LLM_MODEL` / `OPENAI_MODEL` (default: `gpt-4o-mini`)

### 7. Validate Patch

```bash
npx tsx skills/novel-writer/ts/validate-patch.ts \
  --project my_novel \
  --patch patch.json
```

Checks:

- Protected characters cannot be deleted
- Major character list cannot shrink by >30%
- Protected world keys cannot be erased

### 8. Apply Patch (Auto-Updates Everything)

This is the main entry point for memory updates. It does **everything** in one step:

```bash
npx tsx skills/novel-writer/ts/apply-patch.ts \
  --project my_novel \
  --patch patch.json \
  --chapter 8 \
  --title "回响"
```

What happens automatically:

1. Backs up current memory state
2. Applies character patch (add/update/delete with protection)
3. Applies world_bible patch (add/update/delete with protection)
4. Applies plot_threads patch (add/update/close)
5. Appends timeline entry to `timeline.jsonl`
6. **Auto-indexes the new timeline entry** into `timeline_memory.sqlite` (verso-backed vector + FTS)
7. Updates `state.json` (last_chapter, chapters_written, updated_at)
8. On failure: rolls back all JSON files to backup state

### 9. Bulk Re-Index Timeline (Optional)

If you need to rebuild the timeline DB from scratch (e.g. after manual edits to timeline.jsonl):

```bash
npx tsx skills/novel-writer/ts/ingest-timeline.ts \
  --project my_novel
```

Use `--force` to re-index all entries even if hashes match.

### 10. Search Style or Timeline

Standalone search for debugging or exploration:

```bash
# Search style library
npx tsx skills/novel-writer/ts/search.ts \
  --db style \
  --query "dark gothic atmosphere" \
  --limit 5

# Search project timeline
npx tsx skills/novel-writer/ts/search.ts \
  --db timeline \
  --project my_novel \
  --query "betrayal scene" \
  --limit 5
```

### 11. Check Progress

```bash
npx tsx skills/novel-writer/ts/status.ts --project my_novel --recent 5
```

Returns last chapter, all chapters written, and recent timeline entries.

## Complete Chapter Workflow (End-to-End)

```bash
PROJECT="my_novel"
CHAPTER=8
TITLE="回响"

# 1. Get context for writing
npx tsx skills/novel-writer/ts/context.ts \
  --project $PROJECT \
  --outline "林澈在旧港码头发现暗门，苏宁被跟踪" \
  --recent 5 > context.json

# 2. Agent writes chapter using context → saves to chapter.txt

# 3. Extract memory updates
npx tsx skills/novel-writer/ts/extract-updates.ts \
  --project $PROJECT \
  --chapter $CHAPTER \
  --title "$TITLE" \
  --text chapter.txt > patch.json

# 4. Validate
npx tsx skills/novel-writer/ts/validate-patch.ts \
  --project $PROJECT \
  --patch patch.json

# 5. Apply (auto-updates all 4 layers + timeline DB + state)
npx tsx skills/novel-writer/ts/apply-patch.ts \
  --project $PROJECT \
  --patch patch.json \
  --chapter $CHAPTER \
  --title "$TITLE"

# 6. Verify
npx tsx skills/novel-writer/ts/status.ts --project $PROJECT
```

## Four-Layer Continuity Memory

### characters.json

```json
{
  "characters": [
    {
      "name": "林澈",
      "aliases": ["阿澈"],
      "role": "main",
      "traits": ["谨慎", "冷静"],
      "status": "alive",
      "relations": { "苏宁": "搭档" },
      "protected": true
    }
  ]
}
```

### world_bible.json

```json
{
  "world": {
    "rules": ["时间不可回溯"],
    "locations": ["北城", "旧港"],
    "organizations": ["档案局"],
    "tech_level": "near-future"
  },
  "protected_keys": ["rules"]
}
```

### timeline.jsonl (append-only)

```json
{
  "chapter": 2,
  "title": "旧照片",
  "summary": "主角被跟踪并收到旧照片，决定调查。",
  "events": ["主角被跟踪", "收到旧照片"],
  "consequences": ["开始调查"],
  "pov": "第三人称",
  "locations": ["旧港码头"],
  "characters": ["林澈", "苏宁"],
  "updated_at": "2026-02-10 12:00:00"
}
```

### plot_threads.json

```json
{
  "threads": [
    {
      "thread_id": "t-ghost-interest",
      "introduced_in": 2,
      "promise": "主角被人惦记",
      "stakes": "身份/安全",
      "status": "open",
      "must_resolve_by": 8,
      "notes": "有人暗中关注"
    }
  ]
}
```

### state.json

```json
{
  "last_chapter": 8,
  "last_title": "回响",
  "updated_at": "2026-02-10 12:00:00",
  "chapters_written": [
    { "chapter": 7, "title": "裂缝" },
    { "chapter": 8, "title": "回响" }
  ]
}
```

## Patch Format

Every chapter **must** produce a patch JSON. If a layer has no changes, emit empty patch objects (not omitted).

### Required Empty Patch (No Updates)

```json
{
  "characters": { "add": [], "update": [], "delete": [] },
  "world_bible": { "add": {}, "update": {}, "delete": [] },
  "timeline": {
    "summary": "",
    "events": [],
    "consequences": [],
    "pov": "",
    "locations": [],
    "characters": []
  },
  "plot_threads": { "add": [], "update": [], "close": [] }
}
```

### Patch Examples

#### characters (add + update)

```json
{
  "characters": {
    "add": [{ "name": "顾眠", "role": "support", "traits": ["谨慎"], "status": "alive" }],
    "update": [{ "name": "林澈", "status": "injured", "traits": ["冷静", "受伤"] }],
    "delete": []
  }
}
```

#### world_bible (add locations/rules)

```json
{
  "world_bible": {
    "add": { "locations": ["旧港码头"], "organizations": ["档案局"] },
    "update": { "tech_level": "near-future" },
    "delete": []
  }
}
```

#### timeline (chapter summary + events)

```json
{
  "timeline": {
    "summary": "主角发现被跟踪，决定调查旧港码头。",
    "events": ["被跟踪", "收到旧照片", "决定调查旧港码头"],
    "consequences": ["开始调查线索"],
    "pov": "第三人称",
    "locations": ["旧港码头"],
    "characters": ["林澈", "苏宁"]
  }
}
```

#### plot_threads (add foreshadowing / close thread)

```json
{
  "plot_threads": {
    "add": [
      {
        "thread_id": "t-ghost-interest",
        "introduced_in": 2,
        "promise": "有人暗中惦记主角",
        "stakes": "身份/安全",
        "status": "open",
        "must_resolve_by": 8,
        "notes": "旧照片线索"
      }
    ],
    "update": [],
    "close": [{ "thread_id": "t-old-case" }]
  }
}
```

`resolved_at` usage:

- empty/absent → not resolved
- number (e.g. 8) → resolved in that chapter

## Safe Update Strategy

- **Never overwrite full memory files.** Only apply patch objects.
- **Validation gates:**
  - Protected characters cannot be deleted
  - Major character list cannot shrink by >30%
  - Protected world keys cannot be erased
- **Transactional:** backup → apply → validate → commit or rollback
- **Auto-index:** timeline entry is automatically embedded and indexed after each chapter

## Embedding Configuration

Embedding provider is resolved from verso config (`~/.verso/verso.json`). Supports:

- OpenAI (`text-embedding-3-small`, etc.)
- Gemini (`gemini-embedding-text-001`, etc.)
- Voyage
- Local models

Embedding cache is per-DB — repeated ingests skip already-embedded chunks.

For LLM-based extraction (`extract-updates.ts`), set:

- `NOVEL_LLM_API_KEY` / `OPENAI_API_KEY`
- `NOVEL_LLM_MODEL` (default: `gpt-4o-mini`)

## Multi-Project Example

```bash
# Project A: 悬疑小说
npx tsx skills/novel-writer/ts/context.ts --project suspense_novel --outline "第3章大纲" --recent 5
npx tsx skills/novel-writer/ts/apply-patch.ts --project suspense_novel --patch patch_a.json --chapter 3 --title "暗流"

# Project B: 科幻小说 (completely isolated memory)
npx tsx skills/novel-writer/ts/context.ts --project scifi_novel --outline "第12章大纲" --recent 5
npx tsx skills/novel-writer/ts/apply-patch.ts --project scifi_novel --patch patch_b.json --chapter 12 --title "星际"

# Both projects share the same style library
npx tsx skills/novel-writer/ts/search.ts --db style --query "紧张氛围描写"
```

## References

- `references/memory_schema.md`: JSON schemas for 4-layer memory + patch format
- `references/style_tags.md`: allowed tags + style taxonomy
- `references/doc_naming.md`: Google Docs naming rules ("NovelName - Chapter X: Title")

## Legacy Python Scripts (Deprecated)

The `scripts/` directory contains the original Python implementations. They remain functional but are superseded by the TypeScript versions in `ts/`. The TS scripts use verso's memory infrastructure for better embedding caching, hierarchical search, and vector indexing.
