---
summary: "How Verso rotates auth profiles and falls back across models"
read_when:
  - Diagnosing auth profile rotation, cooldowns, or model fallback behavior
  - Updating failover rules for auth profiles or models
title: "Model Failover"
---

# Model failover

Verso handles failures in two stages:

1. **Auth profile rotation** within the current provider.
2. # **Model fallback** to the next model in `agents.defaults.model.fallbacks`.
   Verso handles failures in two stages:

1) **Auth profile rotation** within the current provider.
2) **Model fallback** to the next model in `agents.defaults.model.fallbacks`.
   > > > > > > > upstream/main

This doc explains the runtime rules and the data that backs them.

## Auth storage (keys + OAuth)

Verso uses **auth profiles** for both API keys and OAuth tokens.

- Secrets live in `~/.verso/agents/<agentId>/agent/auth-profiles.json` (legacy: `~/.verso/agent/auth-profiles.json`).
- Config `auth.profiles` / `auth.order` are **metadata + routing only** (no secrets).
- Legacy import-only OAuth file: `~/.verso/credentials/oauth.json` (imported into `auth-profiles.json` on first use).

More detail: [/concepts/oauth](/concepts/oauth)

Credential types:

- `type: "api_key"` → `{ provider, key }`
- `type: "oauth"` → `{ provider, access, refresh, expires, email? }` (+ `projectId`/`enterpriseUrl` for some providers)

## Profile IDs

OAuth logins create distinct profiles so multiple accounts can coexist.

- Default: `provider:default` when no email is available.
- OAuth with email: `provider:<email>` (for example `google-antigravity:user@gmail.com`).

Profiles live in `~/.verso/agents/<agentId>/agent/auth-profiles.json` under `profiles`.

## Rotation order

When a provider has multiple profiles, Verso chooses an order like this:

1. **Explicit config**: `auth.order[provider]` (if set).
2. **Configured profiles**: `auth.profiles` filtered by provider.
3. **Stored profiles**: entries in `auth-profiles.json` for the provider.

If no explicit order is configured, Verso uses a round‑robin order:

If no explicit order is configured, Verso uses a round‑robin order:
