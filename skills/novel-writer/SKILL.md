---
name: novel-writer
description: Create and maintain long-form serialized fiction with a shared style library and per-project four-layer continuity memory. Ingest authorized corpora for style indexing, generate chapters from outlines, auto-update character/world/timeline/plot-thread memory after each chapter, and optionally save to Google Docs.
---

## ⚠️ Mandatory Rules (must follow before writing any chapter)

1. **Each chapter must output 10000+ tokens（约 5000+ 中文字）.** No short chapters.
2. **Write to file, NEVER to chat.** Save chapter text directly to `chapters/chapter-XX.txt`. Only output a one-line confirmation in the conversation.
3. **When rewriting a chapter, use rewrite mode** which automatically reverts memory before rewriting.
4. **Apply patch per chapter individually.** Never merge multiple chapters into one patch.
5. **Read the project `RULES.md` before writing** (located at `projects/<project>/RULES.md`).
6. **After every chapter, immediately update project memory.** The autonomous engine handles this automatically.

# Novel Writer

## Overview

Style-aware, continuity-safe fiction pipeline: ingest corpus → index style → write chapters from outline → auto-update four-layer story memory → optionally save to Google Docs.

All scripts are in `skills/novel-writer/ts/` and built to `dist/skills/novel-writer/`. Embedding and vector search are powered by verso's memory infrastructure (sqlite-vec, FTS5, hierarchical search, embedding cache).

## Architecture

```
skills/novel-writer/
├── ts/                         # TypeScript source (built by tsdown)
│   ├── write-chapter.ts        # Autonomous engine (write + rewrite modes)
│   ├── revert-memory.ts        # Memory rollback for rewrite mode
│   ├── novel-memory.ts         # Core: isolated SQLite DBs with verso's memory schema
│   ├── ingest-style.ts         # Ingest style corpus → shared style DB
│   ├── ingest-timeline.ts      # Bulk re-index timeline.jsonl → per-project timeline DB
│   ├── search.ts               # Search style or timeline DB
│   ├── context.ts              # Assemble full context (JSON memory + search results)
│   ├── apply-patch.ts          # Apply patch + auto-index timeline + save pre-patch snapshot
│   ├── validate-patch.ts       # Validate patch before applying
│   ├── extract-updates.ts      # LLM-based patch extraction from chapter text
│   └── status.ts               # Show project progress
├── references/
│   ├── memory_schema.md        # JSON schemas for 4-layer memory
│   ├── style_tags.md           # Allowed tags + style taxonomy
│   └── doc_naming.md           # Google Docs naming rules
├── style/                      # SHARED style DB (all projects)
│   └── style_memory.sqlite     # Verso-backed style index
└── projects/<project>/         # PER-PROJECT isolation
    ├── state.json              # Progress tracking
    ├── RULES.md                # Optional per-project writing rules
    ├── memory/
    │   ├── characters.json
    │   ├── world_bible.json
    │   ├── plot_threads.json
    │   └── timeline.jsonl
    ├── patches/                # Patch history (for rewrite rollback)
    │   ├── patch-01.json       # Archived patch
    │   └── patch-01.pre.json   # Pre-patch snapshot (original values)
    ├── timeline_memory.sqlite  # Verso-backed timeline index (auto-updated)
    ├── chapters/               # Chapter text files (.txt)
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

### Autonomous Mode (Recommended)

One command completes the full pipeline: context assembly → LLM writing → save chapter → extract updates → validate → apply patch → update memory.

**Write new chapter** (auto-detects next chapter number from state.json):

```bash
node dist/skills/novel-writer/write-chapter.js \
  --project my_novel \
  --outline "林澈在旧港码头发现暗门，苏宁被跟踪"
```

**Rewrite existing chapter** (reverts memory → rewrites → re-applies patch):

```bash
node dist/skills/novel-writer/write-chapter.js \
  --project my_novel \
  --rewrite \
  --chapter 8 \
  --notes "节奏太慢，需要加强悬疑感"
```

Returns JSON to stdout:

```json
{
  "summary": "主角发现暗门，苏宁遭遇跟踪...",
  "chapterPath": "skills/novel-writer/projects/my_novel/chapters/chapter-08.txt",
  "wordCount": 5230,
  "memoryUpdated": ["新角色: 守护者", "伏笔: 核心裂痕"],
  "rewritten": false
}
```

Optional flags: `--title "章节标题"`, `--style "noir 悬疑"`, `--budget 8000`

### Manual Mode (Debugging / Fine Control)

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

Load full context (4-layer memory + style snippets + timeline hits) for the agent.

Style and timeline search use the same query settings as verso's main memory (maxResults, minScore, hybrid weights, candidateMultiplier — all read from `~/.verso/verso.json`). Timeline recent entries are selected by a ratio-based token budget (`recentRatio` from dynamic context params) instead of a fixed count.

```bash
npx tsx skills/novel-writer/ts/context.ts \
  --project my_novel \
  --outline "第8章：林澈在旧港码头发现暗门" \
  --style "noir 悬疑 紧张氛围" \
  --budget 8000
```

Returns:

```json
{
  "status": "ok",
  "project": "my_novel",
  "meta": {
    "budget": 8000,
    "recent_ratio": 0.4,
    "timeline_recent_budget": 3200,
    "timeline_recent_count": 12,
    "style_results": 4,
    "timeline_search_results": 3
  },
  "state": { "last_chapter": 7 },
  "characters": { "characters": [] },
  "world_bible": { "world": {}, "protected_keys": [] },
  "plot_threads": { "threads": [] },
  "timeline_recent": [
    /* budget-selected recent entries */
  ],
  "timeline_hits": [
    /* search results from timeline DB */
  ],
  "style_snippets": [
    /* search results from style DB */
  ],
  "default_style": { "tags": [] }
}
```

- `--outline` drives semantic retrieval for both style and timeline
- `--style` adds additional search terms for style retrieval
- `--budget N` total token budget for timeline recent (default: 8000)

### 5. Write Chapter

The agent writes the chapter using the retrieved context. **Write directly to file, never to the conversation.**

**Critical rules:**

- **Minimum length: 5000 words per chapter.** This is a hard requirement.
- **Write to file, not to chat.** Save the chapter text directly to `projects/<project>/chapters/chapter-XX.txt` using a file write tool. Do NOT output the full chapter text in the conversation — this bloats the context window and causes compaction failures after a few chapters.
- **Confirm in chat with a one-line summary only:** e.g. "第8章《回响》已保存到 chapters/chapter-08.txt，共 5230 字。"
- If the draft is shorter than 5000 words, continue writing until the minimum is met before proceeding to memory extraction.

### 6. Extract Memory Updates from Chapter

Use an LLM to extract a structured patch from the chapter text:

```bash
npx tsx skills/novel-writer/ts/extract-updates.ts \
  --project my_novel \
  --chapter 8 \
  --title "回响" \
  --text chapters/chapter-08.txt > patch.json
```

LLM provider/model/auth are resolved automatically from verso config (`agents.defaults.model`).

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

Standalone search for debugging or exploration (uses verso config query settings):

```bash
# Search style library
npx tsx skills/novel-writer/ts/search.ts \
  --db style \
  --query "dark gothic atmosphere"

# Search project timeline
npx tsx skills/novel-writer/ts/search.ts \
  --db timeline \
  --project my_novel \
  --query "betrayal scene"
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

# 1. Get context for writing (dynamic mode — uses verso config settings)
npx tsx skills/novel-writer/ts/context.ts \
  --project $PROJECT \
  --outline "林澈在旧港码头发现暗门，苏宁被跟踪" > context.json

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

LLM-based extraction (`extract-updates.ts`) uses the same provider/model/auth as the main agent, resolved from `agents.defaults.model` in verso config.

## Multi-Project Example

```bash
# Project A: 悬疑小说
npx tsx skills/novel-writer/ts/context.ts --project suspense_novel --outline "第3章大纲"
npx tsx skills/novel-writer/ts/apply-patch.ts --project suspense_novel --patch patch_a.json --chapter 3 --title "暗流"

# Project B: 科幻小说 (completely isolated memory)
npx tsx skills/novel-writer/ts/context.ts --project scifi_novel --outline "第12章大纲"
npx tsx skills/novel-writer/ts/apply-patch.ts --project scifi_novel --patch patch_b.json --chapter 12 --title "星际"

# Both projects share the same style library
npx tsx skills/novel-writer/ts/search.ts --db style --query "紧张氛围描写"
```

## References

- `references/memory_schema.md`: JSON schemas for 4-layer memory + patch format
- `references/style_tags.md`: allowed tags + style taxonomy
- `references/doc_naming.md`: Google Docs naming rules ("NovelName - Chapter X: Title")
