#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

from _novel_lib import ensure_project_dirs, load_json, memory_path, read_recent_timeline


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--recent", type=int, default=5)
    args = ap.parse_args()

    project_dir = ensure_project_dirs(args.project)
    state_path = project_dir / "state.json"
    state = load_json(state_path, {})
    timeline = read_recent_timeline(memory_path(args.project, "timeline"), args.recent)

    output = {
        "status": "ok",
        "project": args.project,
        "last_chapter": state.get("last_chapter"),
        "last_title": state.get("last_title"),
        "updated_at": state.get("updated_at"),
        "recent_timeline": timeline,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
