#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from typing import Any, Dict, List

from _novel_lib import load_json, memory_path


def _by_name(items: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {str(item.get("name", "")).strip(): item for item in items if item.get("name")}


def _validate_characters(current: Dict[str, Any], patch: Dict[str, Any]) -> None:
    items = current.get("characters", [])
    existing = _by_name(items)

    add = patch.get("add", []) or []
    update = patch.get("update", []) or []
    delete = patch.get("delete", []) or []

    to_delete = {str(item.get("name", item)).strip() for item in delete if item}
    protected = {n for n, v in existing.items() if v.get("protected") is True}
    illegal = protected.intersection(to_delete)
    if illegal:
        raise ValueError(f"cannot delete protected characters: {sorted(illegal)}")

    # Guardrail: major character shrink protection
    majors_before = [v for v in existing.values() if v.get("role") == "main" or v.get("protected")]
    majors_after = list(existing.values())

    # Apply adds/updates to compute majors_after
    for item in add:
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        existing[name] = {**existing.get(name, {}), **item}
    for item in update:
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        existing[name] = {**existing.get(name, {}), **item}
    for name in list(to_delete):
        if name in existing and name not in protected:
            existing.pop(name, None)

    majors_after = [v for v in existing.values() if v.get("role") == "main" or v.get("protected")]
    if majors_before and len(majors_after) < max(1, int(len(majors_before) * 0.7)):
        raise ValueError("character shrink validation failed (major characters drop)")


def _validate_world(current: Dict[str, Any], patch: Dict[str, Any]) -> None:
    protected = set(current.get("protected_keys", []))
    delete = patch.get("delete", []) or []
    illegal = [key for key in delete if key in protected]
    if illegal:
        raise ValueError(f"cannot delete protected world keys: {sorted(illegal)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--patch", required=True)
    args = ap.parse_args()

    patch_path = Path(args.patch)
    if not patch_path.exists():
        raise SystemExit(f"patch file not found: {patch_path}")

    patch = json.loads(patch_path.read_text())

    characters = load_json(memory_path(args.project, "characters"), {"characters": []})
    world = load_json(memory_path(args.project, "world_bible"), {"world": {}, "protected_keys": []})

    _validate_characters(characters, patch.get("characters", {}))
    _validate_world(world, patch.get("world_bible", {}))

    print(json.dumps({"status": "ok"}))


if __name__ == "__main__":
    main()
