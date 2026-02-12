#!/usr/bin/env python3
import argparse
import json
import os
from _novel_lib import build_style_db, fts_search, embed_texts, style_lancedb_dir


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--query", required=True)
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--tags", nargs="*", default=[])
    ap.add_argument("--backend", choices=["fts", "lancedb"], default=None)
    args = ap.parse_args()

    backend = args.backend or os.environ.get("NOVEL_STYLE_BACKEND", "fts")
    if backend == "lancedb":
        try:
            import lancedb
        except ImportError:
            raise SystemExit("lancedb not installed. Run: pip install lancedb")
        db_dir = str(style_lancedb_dir())
        db = lancedb.connect(db_dir)
        table = db.open_table("style_chunks")
        query_vec = embed_texts([args.query])[0]
        if args.tags:
            cond = " AND ".join([f"tags_str LIKE '%{tag}%'" for tag in args.tags])
            results = table.search(query_vec).where(cond).limit(args.limit).to_list()
        else:
            results = table.search(query_vec).limit(args.limit).to_list()
        print(json.dumps({"status": "ok", "results": results, "backend": "lancedb"}, ensure_ascii=False))
        return

    db_path = build_style_db()
    if args.tags:
        tag_query = " AND ".join([f'tags:{tag}' for tag in args.tags])
        results = fts_search(db_path, f"{args.query} {tag_query}".strip(), args.limit)
    else:
        results = fts_search(db_path, args.query, args.limit)
    print(json.dumps({"status": "ok", "results": results, "backend": "fts"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
