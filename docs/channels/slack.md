---
summary: "Slack setup for socket or HTTP webhook mode"
read_when: "Setting up Slack or debugging Slack socket/HTTP mode"
title: "Slack"
---

# Slack

## Socket mode (default)

### Quick setup (beginner)

1. Create a Slack app and enable **Socket Mode**.
2. Create an **App Token** (`xapp-...`) and **Bot Token** (`xoxb-...`).
3. # Set tokens for Verso and start the gateway.

1) Create a Slack app and enable **Socket Mode**.
2) Create an **App Token** (`xapp-...`) and **Bot Token** (`xoxb-...`).
3) Set tokens for Verso and start the gateway.
   > > > > > > > upstream/main

Minimal config:

```json5
{
  channels: {
    slack: {
      enabled: true,
      appToken: "xapp-...",
      botToken: "xoxb-...",
    },
  },
}
```

### Setup

1. Create a Slack app (From scratch) in [https://api.slack.com/apps](https://api.slack.com/apps).
2. **Socket Mode** → toggle on. Then go to **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes** with scope `connections:write`. Copy the **App Token** (`xapp-...`).
3. **OAuth & Permissions** → add bot token scopes (use the manifest below). Click **Install to Workspace**. Copy the **Bot User OAuth Token** (`xoxb-...`).
4. Optional: **OAuth & Permissions** → add **User Token Scopes** (see the read-only list below). Reinstall the app and copy the **User OAuth Token** (`xoxp-...`).
5. **Event Subscriptions** → enable events and subscribe to:
   - `message.*` (includes edits/deletes/thread broadcasts)
   - `app_mention`
   - `reaction_added`, `reaction_removed`
   - `member_joined_channel`, `member_left_channel`
   - `channel_rename`
   - `pin_added`, `pin_removed`

6) Invite the bot to channels you want it to read.
7) Slash Commands → create `/verso` if you use `channels.slack.slashCommand`. If you enable native commands, add one slash command per built-in command (same names as `/help`). Native defaults to off for Slack unless you set `channels.slack.commands.native: true` (global `commands.native` is `"auto"` which leaves Slack off).
8) App Home → enable the **Messages Tab** so users can DM the bot.

Use the manifest below so scopes and events stay in sync.

Multi-account support: use `channels.slack.accounts` with per-account tokens and optional `name`. See [`gateway/configuration`](/gateway/configuration#telegramaccounts--discordaccounts--slackaccounts--signalaccounts--imessageaccounts) for the shared pattern.

### Verso config (minimal)

Set tokens via env vars (recommended):

- `SLACK_APP_TOKEN=xapp-...`
- `SLACK_BOT_TOKEN=xoxb-...`

Or via config:

```json5
{
  channels: {
    slack: {
      enabled: true,
      appToken: "xapp-...",
      botToken: "xoxb-...",
    },
  },
}
```

### User token (optional)

Verso can use a Slack user token (`xoxp-...`) for read operations (history,
