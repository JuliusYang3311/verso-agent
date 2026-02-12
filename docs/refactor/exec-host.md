---
summary: "Refactor plan: exec host routing, node approvals, and headless runner"
read_when:
  - Designing exec host routing or exec approvals
  - Implementing node runner + UI IPC
  - Adding exec host security modes and slash commands
title: "Exec Host Refactor"
---

# Exec host refactor plan

## Goals

- Add `exec.host` + `exec.security` to route execution across **sandbox**, **gateway**, and **node**.
- Keep defaults **safe**: no cross-host execution unless explicitly enabled.
- Split execution into a **headless runner service** with optional UI (macOS app) via local IPC.
- Provide **per-agent** policy, allowlist, ask mode, and node binding.
- Support **ask modes** that work _with_ or _without_ allowlists.
- Cross-platform: Unix socket + token auth (macOS/Linux/Windows parity).

## Non-goals

- No legacy allowlist migration or legacy schema support.
- No PTY/streaming for node exec (aggregated output only).
- No new network layer beyond the existing Bridge + Gateway.

## Decisions (locked)

- **Config keys:** `exec.host` + `exec.security` (per-agent override allowed).
- **Elevation:** keep `/elevated` as an alias for gateway full access.
- **Ask default:** `on-miss`.
- **Approvals store:** `~/.verso/exec-approvals.json` (JSON, no legacy migration).
- **Runner:** headless system service; UI app hosts a Unix socket for approvals.
- **Node identity:** use existing `nodeId`.
- **Socket auth:** Unix socket + token (cross-platform); split later if needed.
- **Node host state:** `~/.verso/node.json` (node id + pairing token).
- **macOS exec host:** run `system.run` inside the macOS app; node host service forwards requests over local IPC.
- **No XPC helper:** stick to Unix socket + token + peer checks.

## Key concepts

### Host

- `sandbox`: Docker exec (current behavior).
- `gateway`: exec on gateway host.
- `node`: exec on node runner via Bridge (`system.run`).

### Security mode

- `deny`: always block.
- `allowlist`: allow only matches.
- `full`: allow everything (equivalent to elevated).

### Ask mode

- `off`: never ask.
- `on-miss`: ask only when allowlist does not match.
- `always`: ask every time.

Ask is **independent** of allowlist; allowlist can be used with `always` or `on-miss`.

### Policy resolution (per exec)

1. Resolve `exec.host` (tool param → agent override → global default).
2. Resolve `exec.security` and `exec.ask` (same precedence).
3. If host is `sandbox`, proceed with local sandbox exec.
4. If host is `gateway` or `node`, apply security + ask policy on that host.

## Default safety

- Default `exec.host = sandbox`.
- Default `exec.security = deny` for `gateway` and `node`.
- Default `exec.ask = on-miss` (only relevant if security allows).
- If no node binding is set, **agent may target any node**, but only if policy allows it.

## Config surface

### Tool parameters

- `exec.host` (optional): `sandbox | gateway | node`.
- `exec.security` (optional): `deny | allowlist | full`.
- `exec.ask` (optional): `off | on-miss | always`.
- `exec.node` (optional): node id/name to use when `host=node`.

### Config keys (global)

- `tools.exec.host`
- `tools.exec.security`
- `tools.exec.ask`
- `tools.exec.node` (default node binding)

### Config keys (per agent)

- `agents.list[].tools.exec.host`
- `agents.list[].tools.exec.security`
- `agents.list[].tools.exec.ask`
- `agents.list[].tools.exec.node`

### Alias

- `/elevated on` = set `tools.exec.host=gateway`, `tools.exec.security=full` for the agent session.
- `/elevated off` = restore previous exec settings for the agent session.

## Approvals store (JSON)

Path: `~/.verso/exec-approvals.json`
