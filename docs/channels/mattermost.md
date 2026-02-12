---
summary: "Mattermost bot setup and Verso config"
read_when:
  - Setting up Mattermost
  - Debugging Mattermost routing
title: "Mattermost"
---

# Mattermost (plugin)

Status: supported via plugin (bot token + WebSocket events). Channels, groups, and DMs are supported.
Mattermost is a self-hostable team messaging platform; see the official site at
[mattermost.com](https://mattermost.com) for product details and downloads.

## Plugin required

Mattermost ships as a plugin and is not bundled with the core install.

Install via CLI (npm registry):

```bash
verso plugins install @verso/mattermost
```

Local checkout (when running from a git repo):

```bash
verso plugins install ./extensions/mattermost
```

If you choose Mattermost during configure/onboarding and a git checkout is detected,
Verso will offer the local install path automatically.

Details: [Plugins](/tools/plugin)

## Quick setup

1. Install the Mattermost plugin.
2. Create a Mattermost bot account and copy the **bot token**.
3. Copy the Mattermost **base URL** (e.g., `https://chat.example.com`).
4. # Configure Verso and start the gateway.

1) Install the Mattermost plugin.
2) Create a Mattermost bot account and copy the **bot token**.
3) Copy the Mattermost **base URL** (e.g., `https://chat.example.com`).
4) Configure Verso and start the gateway.
   > > > > > > > upstream/main

Minimal config:

```json5
{
  channels: {
    mattermost: {
      enabled: true,
      botToken: "mm-token",
      baseUrl: "https://chat.example.com",
      dmPolicy: "pairing",
    },
  },
}
```

## Environment variables (default account)

Set these on the gateway host if you prefer env vars:

- `MATTERMOST_BOT_TOKEN=...`
- `MATTERMOST_URL=https://chat.example.com`

Env vars apply only to the **default** account (`default`). Other accounts must use config values.

## Chat modes

Mattermost responds to DMs automatically. Channel behavior is controlled by `chatmode`:

- `oncall` (default): respond only when @mentioned in channels.
- `onmessage`: respond to every channel message.
- `onchar`: respond when a message starts with a trigger prefix.

Config example:

```json5
{
  channels: {
    mattermost: {
      chatmode: "onchar",
      oncharPrefixes: [">", "!"],
    },
  },
}
```

Notes:

- `onchar` still responds to explicit @mentions.
- `channels.mattermost.requireMention` is honored for legacy configs but `chatmode` is preferred.

## Access control (DMs)

- Default: `channels.mattermost.dmPolicy = "pairing"` (unknown senders get a pairing code).
- Approve via:
  - `verso pairing list mattermost`
  - `verso pairing approve mattermost <CODE>`
- Public DMs: `channels.mattermost.dmPolicy="open"` plus `channels.mattermost.allowFrom=["*"]`.

## Channels (groups)

- Default: `channels.mattermost.groupPolicy = "allowlist"` (mention-gated).
- Allowlist senders with `channels.mattermost.groupAllowFrom` (user IDs or `@username`).
- Open channels: `channels.mattermost.groupPolicy="open"` (mention-gated).

## Targets for outbound delivery

Use these target formats with `verso message send` or cron/webhooks:
