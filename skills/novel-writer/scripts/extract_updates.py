#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

from _novel_lib import call_chat, llm_env


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--chapter", required=True, type=int)
    ap.add_argument("--title", required=True)
    ap.add_argument("--text", required=True)
    ap.add_argument("--max_tokens", type=int, default=1200)
    args = ap.parse_args()

    chapter_text = Path(args.text).read_text(encoding="utf-8")

    system = (
        "Extract continuity updates as JSON patch. Never delete protected entries. "
        "Output only JSON with keys: characters, world_bible, timeline, plot_threads. "
        "Timeline must include a concise summary."
    )
    user = {
        "chapter": args.chapter,
        "title": args.title,
        "text": chapter_text,
        "schema": {
            "characters": {"add": [], "update": [], "delete": []},
            "world_bible": {"add": [], "update": [], "delete": []},
            "timeline": {"summary": "", "events": [], "consequences": [], "pov": "", "locations": [], "characters": []},
            "plot_threads": {"add": [], "update": [], "close": []},
        },
    }

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
    ]

    base_url, api_key, model = llm_env()
    content = call_chat(base_url, api_key, model, messages, max_tokens=args.max_tokens)
    print(content)


if __name__ == "__main__":
    main()
