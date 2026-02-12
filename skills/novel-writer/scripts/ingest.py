#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from typing import Dict, List

from _novel_lib import build_style_db, ensure_project_dirs, fts_insert, embed_texts, style_lancedb_dir, STYLE_DIR


def chunk_text(text: str, min_chars: int, max_chars: int) -> List[str]:
    chunks = []
    text = text.strip().replace("\r", "")
    if not text:
        return chunks
    start = 0
    while start < len(text):
        end = min(len(text), start + max_chars)
        chunk = text[start:end]
        if len(chunk) < min_chars and end < len(text):
            end = min(len(text), start + min_chars)
            chunk = text[start:end]
        chunks.append(chunk.strip())
        start = end
    return [c for c in chunks if c]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--source_dir", required=True)
    ap.add_argument("--glob", default="**/*.txt")
    ap.add_argument("--min_chars", type=int, default=500)
    ap.add_argument("--max_chars", type=int, default=1200)
    ap.add_argument("--author", default="")
    ap.add_argument("--genre", default="")
    ap.add_argument("--pov", default="")
    ap.add_argument("--rhythm", default="")
    ap.add_argument("--tone", default="")
    ap.add_argument("--tags", nargs="*", default=[])
    ap.add_argument("--metadata_json", default="")
    ap.add_argument("--backend", choices=["fts", "lancedb"], default="fts")
    ap.add_argument("--batch_size", type=int, default=32)
    args = ap.parse_args()

    ensure_project_dirs(args.project)
    STYLE_DIR.mkdir(parents=True, exist_ok=True)
    corpus_path = STYLE_DIR / "style_corpus.jsonl"

    meta_base = {
        "author": args.author,
        "genre": args.genre,
        "pov": args.pov,
        "rhythm": args.rhythm,
        "tone": args.tone,
        "tags": args.tags,
    }
    if args.metadata_json:
        meta_base.update(json.loads(Path(args.metadata_json).read_text()))

    source_dir = Path(args.source_dir)
    files = list(source_dir.glob(args.glob))
    if not files:
        raise SystemExit("no files matched")

    rows: List[Dict] = []
    for fp in files:
        text = fp.read_text(encoding="utf-8", errors="ignore")
        for chunk in chunk_text(text, args.min_chars, args.max_chars):
            row = {"text": chunk, "project": args.project, **meta_base}
            rows.append(row)
            with corpus_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(row, ensure_ascii=False))
                f.write("\n")

    if args.backend == "fts":
        db_path = build_style_db()
        fts_insert(db_path, rows)
        print(json.dumps({"status": "ok", "chunks": len(rows), "db": str(db_path), "backend": "fts"}))
        return

    try:
        import lancedb
    except ImportError:
        raise SystemExit("lancedb not installed. Run: pip install lancedb")

    db_dir = style_lancedb_dir()
    db = lancedb.connect(str(db_dir))
    table_name = "style_chunks"

    # Build embeddings in batches.
    all_rows = []
    for i in range(0, len(rows), args.batch_size):
        batch = rows[i : i + args.batch_size]
        embeddings = embed_texts([r["text"] for r in batch])
        for row, emb in zip(batch, embeddings):
            all_rows.append(
                {
                    "text": row["text"],
                    "author": row.get("author", ""),
                    "genre": row.get("genre", ""),
                    "pov": row.get("pov", ""),
                    "rhythm": row.get("rhythm", ""),
                    "tone": row.get("tone", ""),
                    "tags": row.get("tags", []),
                    "tags_str": ",".join(row.get("tags", []) or []),
                    "embedding": emb,
                }
            )

    if table_name in db.table_names():
        table = db.open_table(table_name)
        table.add(all_rows)
    else:
        table = db.create_table(table_name, all_rows)

    print(json.dumps({"status": "ok", "chunks": len(rows), "db": str(db_dir), "backend": "lancedb"}))


if __name__ == "__main__":
    main()
