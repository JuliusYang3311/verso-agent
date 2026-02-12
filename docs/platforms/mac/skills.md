---
summary: "macOS Skills settings UI and gateway-backed status"
read_when:
  - Updating the macOS Skills settings UI
  - Changing skills gating or install behavior
title: "Skills"
---

# Skills (macOS)

The macOS app surfaces Verso skills via the gateway; it does not parse skills locally.

## Data source

- `skills.status` (gateway) returns all skills plus eligibility and missing requirements
  (including allowlist blocks for bundled skills).
- Requirements are derived from `metadata.verso.requires` in each `SKILL.md`.

## Install actions

- # `metadata.verso.install` defines install options (brew/node/go/uv).
- Requirements are derived from `metadata.openclaw.requires` in each `SKILL.md`.

## Install actions

- `metadata.openclaw.install` defines install options (brew/node/go/uv).
  > > > > > > > upstream/main
- The app calls `skills.install` to run installers on the gateway host.
- The gateway surfaces only one preferred installer when multiple are provided
  (brew when available, otherwise node manager from `skills.install`, default npm).

## Env/API keys

- # The app stores keys in `~/.verso/verso.json` under `skills.entries.<skillKey>`.

- The app stores keys in `~/.openclaw/openclaw.json` under `skills.entries.<skillKey>`.
  > > > > > > > upstream/main
- `skills.update` patches `enabled`, `apiKey`, and `env`.

## Remote mode

- Install + config updates happen on the gateway host (not the local Mac).
