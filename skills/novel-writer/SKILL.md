---
name: novel-writer
description: Create and maintain long-form serialized fiction with a style library and four-layer continuity memory. Use when ingesting authorized novel corpora for style indexing, generating chapters from outlines, updating character/world/timeline/plot-thread memory, and optionally saving chapters to Google Docs with structured naming.
---

# Novel Writer

## Overview

Build a style-aware, continuity-safe fiction pipeline: ingest corpus → index style → write chapters from outline → auto-update four-layer story memory → optionally save to Google Docs.

## Core Workflow (Sequential)

1. **Ingest & Index Style Corpus** (authorized text only)
2. **Load Story Memory** (4-layer continuity, per novel)
3. **Retrieve Style + Memory Context** (for your agent to write)
4. **Post-Write Extraction** (diff/patch updates + summary)
5. **Merge + Validate + Backup** (safe memory updates)
6. **Track Progress** (`state.json` + `timeline.jsonl`)
7. **(Optional) Save to Google Docs** ("NovelName - Chapter X: Title")

## Key Concepts

### A) Style Library (RAG)

- Chunk corpus: 500–1200 chars with metadata: author, genre, POV, rhythm, tone, tags.
- Vector index (LanceDB recommended).
- Retrieval output should be **style guidance**, not copied text.
- Embeddings default to OpenAI-compatible API, but **Gemini embeddings are supported**.

**Style library is shared across all projects** and stored under:
`/Users/veso/Documents/verso/skills/novel-writer/style/`

### B) Four-Layer Continuity Memory (Per Novel Project)

- `characters.json` — names, aliases, traits, relationships, status (protect key characters).
- `world_bible.json` — rules, locations, organizations, tech/magic limits.
- `timeline.jsonl` — per-chapter events + consequences.
- `plot_threads.json` — promises/foreshadowing with `introduced_in`, `must_resolve_by`, `status`.

Each novel has its own isolated memory under:
`/Users/veso/Documents/verso/skills/novel-writer/projects/<project>/memory/`

Progress tracking:

- `state.json` stores `last_chapter`, `last_title`, `updated_at`
- `state.json` also stores `chapters_written` (list of chapter/title)
- `timeline.jsonl` stores per-chapter summaries/events

**Timeline embeddings are per project** and stored under:
`/Users/veso/Documents/verso/skills/novel-writer/projects/<project>/timeline/`

### C) Safe Update Strategy (Patch + Validate)

- **Never overwrite full memory files.** Only apply patch objects:
  - `add`, `update`, `delete` arrays.
- **Validation gates:**
  - Do not allow major character list shrink.
  - Protected entries cannot be deleted.
  - World rules cannot be erased.
- **Transactional update:** backup → apply patch → validate → commit or rollback.

### D) Required Patch Output (Every Chapter)

Your LLM **must** emit a patch JSON after each chapter.  
If a layer has no changes, emit **empty patch objects** (not omitted).

Required keys (always present):

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

Empty patch objects are **no-ops** when applied.

## Patch Examples (LLM Reference)

### characters

```json
{
  "characters": {
    "add": [{ "name": "顾眠", "role": "support", "traits": ["谨慎"], "status": "alive" }],
    "update": [{ "name": "林澈", "status": "injured", "traits": ["冷静", "受伤"] }],
    "delete": []
  },
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

### world_bible

```json
{
  "characters": { "add": [], "update": [], "delete": [] },
  "world_bible": {
    "add": { "locations": ["旧港码头"], "organizations": ["档案局"] },
    "update": { "tech_level": "near-future" },
    "delete": []
  },
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

### timeline

```json
{
  "characters": { "add": [], "update": [], "delete": [] },
  "world_bible": { "add": {}, "update": {}, "delete": [] },
  "timeline": {
    "summary": "主角发现被跟踪，决定调查旧港码头。",
    "events": ["被跟踪", "收到旧照片", "决定调查旧港码头"],
    "consequences": ["开始调查线索"],
    "pov": "第三人称",
    "locations": ["旧港码头"],
    "characters": ["林澈", "苏宁"]
  },
  "plot_threads": { "add": [], "update": [], "close": [] }
}
```

### plot_threads

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
  "plot_threads": {
    "add": [
      {
        "thread_id": "t-ghost-interest",
        "introduced_in": 2,
        "promise": "有人暗中惦记主角",
        "stakes": "身份/安全",
        "status": "open",
        "resolved_at": 8,
        "notes": "旧照片线索"
      }
    ],
    "update": [],
    "close": []
  }
}
```

`resolved_at` usage:

- empty/absent → not resolved
- number (e.g. 8) → resolved in that chapter

## Scripts (in scripts/)

- `ingest.py`: chunk corpus + build vector index
- `retrieve_style.py`: return top-k style summaries
- `extract_updates.py`: structured diff output for memory
- `apply_patch.py`: safe merge + validation + rollback
- `validate_patch.py`: validate patch before applying
- `context.py`: return style + 4-layer memory + recent timeline
- `status.py`: show current chapter + recent timeline
- `save_to_docs.py`: create Google Doc (name format: "NovelName - Chapter X: Title")

## References (place in references/)

- `memory_schema.md`: JSON schemas for 4-layer memory
- `style_tags.md`: allowed tags + style taxonomy
- `doc_naming.md`: Google Docs naming rules

## Usage Examples

### Ingest (LanceDB vector index)

```bash
NOVEL_STYLE_BACKEND=lancedb \
NOVEL_EMBED_PROVIDER=gemini \
NOVEL_EMBED_MODEL="gemini-embedding-text-001" \
NOVEL_EMBED_TASK_TYPE="RETRIEVAL_DOCUMENT" \
python3 scripts/ingest.py \
  --project "my_novel" \
  --source_dir "/Users/veso/Documents/novel_corpus" \
  --backend lancedb
```

Notes:

- If `NOVEL_EMBED_API_KEY` is not set, the skill will try to read the Google API key from `~/.verso/verso.json` (common fields).
- You can override with `NOVEL_EMBED_API_KEY` explicitly.
- If you add `--tags`, they are stored and can be used to filter retrieval.
- Style ingest always writes to the **shared** style DB under `skills/novel-writer/style/`.
- Timeline ingest is **project‑scoped** and happens only during `apply_patch.py` (never saved into the style DB).

### Retrieve context for your agent

```bash
python3 scripts/context.py \
  --project "my_novel" \
  --outline "本章大纲/语义检索关键词" \
  --tags noir 悬疑 快节奏 \
  --recent 5
```

Load full timeline (all chapters):

```bash
python3 scripts/context.py \
  --project "my_novel" \
  --outline "本章大纲/语义检索关键词" \
  --full_timeline
```

`context.py` returns:

```json
{
  "characters": { ... },
  "world_bible": { ... },
  "plot_threads": { ... },
  "timeline_recent": [ ... ],
  "timeline_hits": [ ... ],
  "style_snippets": [ ... ]
}
```

Notes:

- `outline` drives **semantic retrieval** for both `style_snippets` and `timeline_hits`.
- `tags` is used only as **tag filters** for the style DB (does not affect timeline retrieval).

### Default style per project (tags only)

Create `/Users/veso/Documents/verso/skills/novel-writer/projects/<project>/style/default_style.json`:

```json
{
  "tags": ["悬疑", "快节奏", "noir"]
}
```

`default_style.json` only provides tag filters. `--outline` must be passed at runtime.

### Update memory safely (two-step)

```bash
python3 scripts/extract_updates.py --project my_novel --chapter 8 --text chapter.txt > patch.json
python3 scripts/validate_patch.py --project my_novel --patch patch.json
python3 scripts/apply_patch.py --project my_novel --patch patch.json
```

### Timeline ingest example (project‑scoped)

`apply_patch.py` appends to `memory/timeline.jsonl` and embeds into:
`/Users/veso/Documents/verso/skills/novel-writer/projects/<project>/timeline/lancedb`

```bash
python3 scripts/apply_patch.py \
  --project my_novel \
  --patch patch.json \
  --chapter 8 \
  --title "回响"
```

### Check progress

```bash
python3 scripts/status.py --project my_novel --recent 5
```

### Save to Google Docs

```bash
python3 scripts/save_to_docs.py \
  --title "My Novel - Chapter 8: Echo" \
  --file chapter.txt
```
