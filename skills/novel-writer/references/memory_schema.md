# Continuity Memory Schemas (v1)

## characters.json

```json
{
  "project": "my_novel",
  "characters": [
    {
      "name": "林澈",
      "aliases": ["阿澈"],
      "traits": ["谨慎", "冷静"],
      "status": "alive",
      "relations": { "苏宁": "搭档" },
      "protected": true
    }
  ]
}
```

## world_bible.json

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

## timeline.jsonl

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

## plot_threads.json

```json
{
  "project": "my_novel",
  "threads": [
    {
      "thread_id": "t-ghost-interest",
      "introduced_in": 2,
      "promise": "主角被人惦记",
      "stakes": "身份/安全",
      "status": "open",
      "resolved_at": 8,
      "notes": "有人暗中关注"
    }
  ]
}
```

## state.json

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

## Patch Format (diff)

```json
{
  "characters": {
    "add": [{ "name": "新角色" }],
    "update": [{ "name": "林澈", "status": "injured" }],
    "delete": []
  },
  "world_bible": {
    "add": { "locations": ["新地点"] },
    "update": { "tech_level": "modern" },
    "delete": ["obsolete_rule"]
  },
  "timeline": {
    "summary": "本章摘要",
    "events": ["..."],
    "consequences": ["..."],
    "pov": "第三人称",
    "locations": ["旧港码头"],
    "characters": ["林澈", "苏宁"]
  },
  "plot_threads": {
    "add": [{ "thread_id": "t-new" }],
    "update": [{ "thread_id": "t-ghost-interest", "status": "closed" }],
    "close": [{ "thread_id": "t-old" }]
  }
}
```

## Required Empty Patch (No Updates)

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

## Per-Layer Patch Examples

### characters (新增 + 更新)

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

### world_bible (新增地点/规则)

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

### timeline (本章摘要 + 事件)

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

### plot_threads (伏笔新增/回收)

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
        "must_resolve_by": 8,
        "notes": "旧照片线索"
      }
    ],
    "update": [],
    "close": []
  }
}
```
