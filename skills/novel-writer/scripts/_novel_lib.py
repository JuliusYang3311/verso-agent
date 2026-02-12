#!/usr/bin/env python3
import json
import os
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path("/Users/veso/Documents/verso/skills/novel-writer")
PROJECTS_DIR = ROOT / "projects"
STYLE_DIR = ROOT / "style"

MEMORY_FILES = {
    "characters": "characters.json",
    "world_bible": "world_bible.json",
    "plot_threads": "plot_threads.json",
    "timeline": "timeline.jsonl",
}


def ensure_project_dirs(project: str) -> Path:
    project_dir = PROJECTS_DIR / project
    (project_dir / "memory").mkdir(parents=True, exist_ok=True)
    (project_dir / "chapters").mkdir(parents=True, exist_ok=True)
    (project_dir / "style").mkdir(parents=True, exist_ok=True)
    (project_dir / "gdocs").mkdir(parents=True, exist_ok=True)
    return project_dir


def memory_path(project: str, key: str) -> Path:
    project_dir = ensure_project_dirs(project)
    return project_dir / "memory" / MEMORY_FILES[key]


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text())


def save_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def append_jsonl(path: Path, data: Dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False))
        f.write("\n")


def slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"[^a-z0-9\-\u4e00-\u9fff]+", "", text)
    return text[:64] or "chapter"


def build_style_db() -> Path:
    STYLE_DIR.mkdir(parents=True, exist_ok=True)
    db_path = STYLE_DIR / "style_index.sqlite"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
        USING fts5(text, project, author, genre, pov, rhythm, tone, tags);
        """
    )
    conn.commit()
    conn.close()
    return db_path


def style_lancedb_dir() -> Path:
    STYLE_DIR.mkdir(parents=True, exist_ok=True)
    return STYLE_DIR / "lancedb"


def timeline_lancedb_dir(project: str) -> Path:
    project_dir = ensure_project_dirs(project)
    timeline_dir = project_dir / "timeline"
    timeline_dir.mkdir(parents=True, exist_ok=True)
    return timeline_dir / "lancedb"


def fts_insert(db_path: Path, rows: List[Dict[str, Any]]) -> None:
    conn = sqlite3.connect(db_path)
    with conn:
        conn.executemany(
            "INSERT INTO chunks_fts(text, project, author, genre, pov, rhythm, tone, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    row.get("text", ""),
                    row.get("project", ""),
                    row.get("author", ""),
                    row.get("genre", ""),
                    row.get("pov", ""),
                    row.get("rhythm", ""),
                    row.get("tone", ""),
                    ",".join(row.get("tags", []) or []),
                )
                for row in rows
            ],
        )
    conn.close()


def fts_search(db_path: Path, query: str, limit: int) -> List[Dict[str, Any]]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT rowid, text, project, author, genre, pov, rhythm, tone, tags FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT ?",
        (query, limit),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def read_recent_timeline(path: Path, limit: int) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    lines = path.read_text().splitlines()[-limit:]
    return [json.loads(line) for line in lines if line.strip()]


def llm_env() -> Tuple[str, str, str]:
    base_url = os.environ.get("NOVEL_LLM_BASE_URL") or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1"
    api_key = os.environ.get("NOVEL_LLM_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
    model = os.environ.get("NOVEL_LLM_MODEL") or os.environ.get("OPENAI_MODEL") or "gpt-4o-mini"
    return base_url, api_key, model


def _read_verso_json() -> Dict[str, Any]:
    path = Path(os.path.expanduser("~/.verso/verso.json"))
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def _find_google_api_key(config: Dict[str, Any]) -> str:
    candidates = []
    profiles = config.get("auth", {}).get("profiles", {})
    if isinstance(profiles, dict):
        for key in ("google:default", "google"):
            if key in profiles and isinstance(profiles[key], dict):
                candidates.append(profiles[key].get("apiKey"))

    providers = config.get("models", {}).get("providers", {})
    if isinstance(providers, dict):
        if "google" in providers and isinstance(providers["google"], dict):
            candidates.append(providers["google"].get("apiKey"))

    google_cfg = config.get("google", {})
    if isinstance(google_cfg, dict):
        candidates.append(google_cfg.get("apiKey"))

    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def embed_env() -> Tuple[str, str, str, str]:
    provider = os.environ.get("NOVEL_EMBED_PROVIDER", "").strip().lower()
    model = os.environ.get("NOVEL_EMBED_MODEL") or "text-embedding-3-small"
    if not provider:
        if model.startswith("gemini-embedding-"):
            provider = "gemini"
        else:
            provider = "openai"

    base_url = os.environ.get("NOVEL_EMBED_BASE_URL") or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1"
    api_key = os.environ.get("NOVEL_EMBED_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
    if provider == "gemini" and not api_key:
        api_key = _find_google_api_key(_read_verso_json())
    return provider, base_url, api_key, model


def call_chat(base_url: str, api_key: str, model: str, messages: List[Dict[str, str]], max_tokens: int = 1200) -> str:
    import requests

    if not api_key:
        raise RuntimeError("NOVEL_LLM_API_KEY/OPENAI_API_KEY is required")
    url = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.8,
        "max_tokens": max_tokens,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    resp = requests.post(url, headers=headers, json=payload, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def embed_texts(texts: List[str]) -> List[List[float]]:
    import requests

    provider, base_url, api_key, model = embed_env()
    if not api_key:
        raise RuntimeError("NOVEL_EMBED_API_KEY/OPENAI_API_KEY is required for embeddings")

    if provider == "gemini":
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents"
        task_type = os.environ.get("NOVEL_EMBED_TASK_TYPE") or "RETRIEVAL_DOCUMENT"
        payload = {
            "requests": [
                {
                    "model": f"models/{model}",
                    "content": {"parts": [{"text": text}]},
                    "taskType": task_type,
                }
                for text in texts
            ]
        }
        headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}
        resp = requests.post(url, headers=headers, json=payload, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        return [item["values"] for item in data.get("embeddings", [])]

    url = base_url.rstrip("/") + "/embeddings"
    payload = {"model": model, "input": texts}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    resp = requests.post(url, headers=headers, json=payload, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    return [item["embedding"] for item in data["data"]]


def now_ts() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")
