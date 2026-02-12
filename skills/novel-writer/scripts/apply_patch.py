#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from typing import Any, Dict, List

from _novel_lib import (
    ensure_project_dirs,
    load_json,
    memory_path,
    save_json,
    append_jsonl,
    now_ts,
    embed_texts,
    timeline_lancedb_dir,
)


def _by_name(items: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {str(item.get("name", "")).strip(): item for item in items if item.get("name")}


def _merge_item(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(base)
    for key, value in patch.items():
        if key == "name":
            continue
        merged[key] = value
    return merged


def _apply_character_patch(characters: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    items = characters.get("characters", [])
    existing = _by_name(items)

    add = patch.get("add", []) or []
    update = patch.get("update", []) or []
    delete = patch.get("delete", []) or []

    for item in add:
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        if name in existing:
            existing[name] = _merge_item(existing[name], item)
        else:
            existing[name] = item

    for item in update:
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        if name in existing:
            existing[name] = _merge_item(existing[name], item)
        else:
            existing[name] = item

    protected = {n for n, v in existing.items() if v.get("protected") is True}
    to_delete = {str(item.get("name", item)).strip() for item in delete if item}
    for name in list(to_delete):
        if not name or name in protected:
            to_delete.discard(name)

    remaining = {n: v for n, v in existing.items() if n not in to_delete}

    # Guardrail: major character shrink protection
    majors_before = [v for v in existing.values() if v.get("role") == "main" or v.get("protected")]
    majors_after = [v for v in remaining.values() if v.get("role") == "main" or v.get("protected")]
    if majors_before and len(majors_after) < max(1, int(len(majors_before) * 0.7)):
        raise RuntimeError("character shrink validation failed (major characters drop)")

    return {"characters": list(remaining.values())}


def _apply_world_patch(world: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    data = world.get("world", {})
    add = patch.get("add", {}) or {}
    update = patch.get("update", {}) or {}
    delete = patch.get("delete", []) or []

    if isinstance(add, dict):
        data.update(add)
    elif isinstance(add, list):
        for item in add:
            if isinstance(item, dict):
                data.update(item)

    if isinstance(update, dict):
        data.update(update)
    elif isinstance(update, list):
        for item in update:
            if isinstance(item, dict):
                data.update(item)

    if isinstance(delete, (list, tuple)):
        for item in delete:
            if isinstance(item, str) and item in data:
                protected = set(world.get("protected_keys", []))
                if item not in protected:
                    data.pop(item, None)
    return {"world": data, "protected_keys": world.get("protected_keys", [])}


def _apply_plot_patch(plot: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    threads = plot.get("threads", [])
    by_id = {t.get("thread_id"): t for t in threads if t.get("thread_id")}

    for item in patch.get("add", []) or []:
        tid = item.get("thread_id")
        if not tid:
            continue
        by_id[tid] = item

    for item in patch.get("update", []) or []:
        tid = item.get("thread_id")
        if not tid:
            continue
        base = by_id.get(tid, {})
        base.update(item)
        by_id[tid] = base

    for item in patch.get("close", []) or []:
        tid = item.get("thread_id") if isinstance(item, dict) else item
        if not tid:
            continue
        base = by_id.get(tid, {"thread_id": tid})
        base["status"] = "closed"
        by_id[tid] = base

    return {"threads": list(by_id.values())}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--patch", required=True)
    ap.add_argument("--chapter", type=int, required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--summary", default="")
    args = ap.parse_args()

    ensure_project_dirs(args.project)
    patch_data = json.loads(Path(args.patch).read_text())

    characters = load_json(memory_path(args.project, "characters"), {"characters": []})
    world = load_json(memory_path(args.project, "world_bible"), {"world": {}, "protected_keys": []})
    plot = load_json(memory_path(args.project, "plot_threads"), {"threads": []})

    characters = _apply_character_patch(characters, patch_data.get("characters", {}))
    world = _apply_world_patch(world, patch_data.get("world_bible", {}))
    plot = _apply_plot_patch(plot, patch_data.get("plot_threads", {}))

    save_json(memory_path(args.project, "characters"), characters)
    save_json(memory_path(args.project, "world_bible"), world)
    save_json(memory_path(args.project, "plot_threads"), plot)

    timeline_entry = {
        "chapter": args.chapter,
        "title": args.title,
        "summary": patch_data.get("timeline", {}).get("summary", "") or args.summary,
        "events": patch_data.get("timeline", {}).get("events", []),
        "consequences": patch_data.get("timeline", {}).get("consequences", []),
        "pov": patch_data.get("timeline", {}).get("pov", ""),
        "locations": patch_data.get("timeline", {}).get("locations", []),
        "characters": patch_data.get("timeline", {}).get("characters", []),
        "updated_at": now_ts(),
    }
    append_jsonl(memory_path(args.project, "timeline"), timeline_entry)

    timeline_backend = "lancedb"
    if timeline_backend == "lancedb":
        try:
            import lancedb
        except ImportError:
            lancedb = None
        if lancedb is not None:
            tdb = lancedb.connect(str(timeline_lancedb_dir(args.project)))
            text = " | ".join(
                [
                    str(timeline_entry.get("title", "")),
                    str(timeline_entry.get("summary", "")),
                    ",".join(timeline_entry.get("events", []) or []),
                    ",".join(timeline_entry.get("consequences", []) or []),
                    ",".join(timeline_entry.get("characters", []) or []),
                    ",".join(timeline_entry.get("locations", []) or []),
                    str(timeline_entry.get("pov", "")),
                ]
            ).strip()
            try:
                embedding = embed_texts([text])[0] if text else embed_texts([str(timeline_entry)])[0]
            except Exception:
                embedding = None
            row = {
                "chapter": args.chapter,
                "title": args.title,
                "summary": timeline_entry.get("summary", ""),
                "events": timeline_entry.get("events", []),
                "consequences": timeline_entry.get("consequences", []),
                "pov": timeline_entry.get("pov", ""),
                "locations": timeline_entry.get("locations", []),
                "characters": timeline_entry.get("characters", []),
                "updated_at": timeline_entry.get("updated_at"),
            }
            if embedding is not None:
                row["embedding"] = embedding
            if "timeline_chunks" in tdb.table_names():
                ttable = tdb.open_table("timeline_chunks")
                ttable.add([row])
            else:
                tdb.create_table("timeline_chunks", [row])

    state_path = ensure_project_dirs(args.project) / "state.json"
    state = load_json(state_path, {})
    written = state.get("chapters_written", [])
    if not isinstance(written, list):
        written = []
    existing = {(item.get("chapter"), item.get("title")) for item in written if isinstance(item, dict)}
    entry = {"chapter": args.chapter, "title": args.title}
    if (entry["chapter"], entry["title"]) not in existing:
        written.append(entry)

    state.update(
        {
            "last_chapter": args.chapter,
            "last_title": args.title,
            "updated_at": now_ts(),
            "chapters_written": written,
        }
    )
    save_json(state_path, state)

    print(json.dumps({"status": "ok", "state": state}, ensure_ascii=False))


if __name__ == "__main__":
    main()
