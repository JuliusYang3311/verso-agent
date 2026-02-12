#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path

from _novel_lib import (
    build_style_db,
    ensure_project_dirs,
    fts_search,
    embed_texts,
    load_json,
    memory_path,
    read_recent_timeline,
    style_lancedb_dir,
    timeline_lancedb_dir,
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--outline", default="")
    ap.add_argument("--style", default="")
    ap.add_argument("--recent", type=int, default=5)
    ap.add_argument("--full_timeline", action="store_true")
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--tags", nargs="*", default=[])
    args = ap.parse_args()

    project_dir = ensure_project_dirs(args.project)
    state_path = project_dir / "state.json"
    state = load_json(state_path, {})

    characters = load_json(memory_path(args.project, "characters"), {"characters": []})
    world = load_json(memory_path(args.project, "world_bible"), {"world": {}, "protected_keys": []})
    plot_threads = load_json(memory_path(args.project, "plot_threads"), {"threads": []})
    timeline_path = memory_path(args.project, "timeline")
    if timeline_path.exists():
        full_timeline = [json.loads(line) for line in timeline_path.read_text().splitlines() if line.strip()]
    else:
        full_timeline = []
    timeline_recent = full_timeline[-args.recent :] if full_timeline else []

    style_snippets = []
    timeline_hits = []
    default_style_path = project_dir / "style" / "default_style.json"
    default_style = {}
    if default_style_path.exists():
        try:
            default_style = json.loads(default_style_path.read_text())
        except Exception:
            default_style = {}

    query = args.outline or args.style
    tags = list(args.tags or [])
    for item in default_style.get("tags", []) or []:
        if item and item not in tags:
            tags.append(item)
    if args.style:
        for item in args.style.replace(",", " ").split():
            if item and item not in tags:
                tags.append(item)
    if query:
        backend = os.environ.get("NOVEL_STYLE_BACKEND", "fts")
        if backend == "lancedb":
            try:
                import lancedb
            except ImportError:
                raise SystemExit("lancedb not installed. Run: pip install lancedb")
            db = lancedb.connect(str(style_lancedb_dir()))
            table = db.open_table("style_chunks")
            query_vec = embed_texts([query])[0]
            if tags:
                cond = " AND ".join([f"tags_str LIKE '%{tag}%'" for tag in tags])
                style_snippets = table.search(query_vec).where(cond).limit(args.limit).to_list()
            else:
                style_snippets = table.search(query_vec).limit(args.limit).to_list()
        else:
            db_path = build_style_db()
            if tags:
                tag_query = " AND ".join([f'tags:{tag}' for tag in tags])
                style_snippets = fts_search(db_path, f"{query} {tag_query}".strip(), args.limit)
            else:
                style_snippets = fts_search(db_path, query, args.limit)

        timeline_backend = os.environ.get("NOVEL_TIMELINE_BACKEND", "lancedb")
        if timeline_backend == "lancedb":
            try:
                import lancedb
            except ImportError:
                raise SystemExit("lancedb not installed. Run: pip install lancedb")
            tdb = lancedb.connect(str(timeline_lancedb_dir(args.project)))
            if "timeline_chunks" in tdb.table_names():
                ttable = tdb.open_table("timeline_chunks")
                tvec = embed_texts([query])[0]
                timeline_hits = ttable.search(tvec).limit(args.limit).to_list()

    output = {
        "status": "ok",
        "project": args.project,
        "state": state,
        "characters": characters,
        "world_bible": world,
        "plot_threads": plot_threads,
        "timeline_recent": timeline_recent,
        "timeline_hits": timeline_hits,
        "style_snippets": style_snippets,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
