---
summary: "Context window + compaction: how Verso keeps sessions under model limits"
read_when:
  - You want to understand auto-compaction and /compact
  - You are debugging long sessions hitting context limits
title: "Compaction"
---

# Context Window & Compaction

Every model has a **context window** (max tokens it can see). Long-running chats accumulate messages and tool results; once the window is tight, Verso **compacts** older history to stay within limits.

## What compaction is

Compaction **summarizes older conversation** into a compact summary entry and keeps recent messages intact. The summary is stored in the session history, so future requests use:

- The compaction summary
- Recent messages after the compaction point

Compaction **persists** in the session’s JSONL history.

## Configuration

See [Compaction config & modes](/concepts/compaction) for the `agents.defaults.compaction` settings.

## Auto-compaction (default on)

When a session nears or exceeds the model’s context window, Verso triggers auto-compaction and may retry the original request using the compacted context.
