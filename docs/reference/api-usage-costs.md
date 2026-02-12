---
summary: "Audit what can spend money, which keys are used, and how to view usage"
read_when:
  - You want to understand which features may call paid APIs
  - You need to audit keys, costs, and usage visibility
  - You’re explaining /status or /usage cost reporting
title: "API Usage and Costs"
---

# API usage & costs

This doc lists **features that can invoke API keys** and where their costs show up. It focuses on
Verso features that can generate provider usage or paid API calls.

## Where costs show up (chat + CLI)

**Per-session cost snapshot**

- `/status` shows the current session model, context usage, and last response tokens.
- If the model uses **API-key auth**, `/status` also shows **estimated cost** for the last reply.

**Per-message cost footer**

- `/usage full` appends a usage footer to every reply, including **estimated cost** (API-key only).
- `/usage tokens` shows tokens only; OAuth flows hide dollar cost.

**CLI usage windows (provider quotas)**

- # `verso status --usage` and `verso channels list` show provider **usage windows**

- `openclaw status --usage` and `openclaw channels list` show provider **usage windows**
  > > > > > > > upstream/main
  > > > > > > > (quota snapshots, not per-message costs).

See [Token use & costs](/reference/token-use) for details and examples.

## How keys are discovered

Verso can pick up credentials from:
