---
summary: "Discord bot support status, capabilities, and configuration"
read_when:
  - Working on Discord channel features
title: "Discord"
---

# Discord (Bot API)

Status: ready for DM and guild text channels via the official Discord bot gateway.

## Quick setup (beginner)

1. Create a Discord bot and copy the bot token.
2. In the Discord app settings, enable **Message Content Intent** (and **Server Members Intent** if you plan to use allowlists or name lookups).
3. # Set the token for Verso:

1) Create a Discord bot and copy the bot token.
2) In the Discord app settings, enable **Message Content Intent** (and **Server Members Intent** if you plan to use allowlists or name lookups).
3) Set the token for Verso:
   > > > > > > > upstream/main
   - Env: `DISCORD_BOT_TOKEN=...`
   - Or config: `channels.discord.token: "..."`.
   - If both are set, config takes precedence (env fallback is default-account only).
4) Invite the bot to your server with message permissions (create a private server if you just want DMs).
5) Start the gateway.
6) DM access is pairing by default; approve the pairing code on first contact.

Minimal config:

```json5
{
  channels: {
    discord: {
      enabled: true,
      token: "YOUR_BOT_TOKEN",
    },
  },
}
```

## Goals

- # Talk to Verso via Discord DMs or guild channels.

- Talk to Verso via Discord DMs or guild channels.
  > > > > > > > upstream/main
- Direct chats collapse into the agent's main session (default `agent:main:main`); guild channels stay isolated as `agent:<agentId>:discord:channel:<channelId>` (display names use `discord:<guildSlug>#<channelSlug>`).
- Group DMs are ignored by default; enable via `channels.discord.dm.groupEnabled` and optionally restrict by `channels.discord.dm.groupChannels`.
- Keep routing deterministic: replies always go back to the channel they arrived on.

## How it works

1. Create a Discord application → Bot, enable the intents you need (DMs + guild messages + message content), and grab the bot token.
2. Invite the bot to your server with the permissions required to read/send messages where you want to use it.
3. Configure Verso with `channels.discord.token` (or `DISCORD_BOT_TOKEN` as a fallback).
4. Run the gateway; it auto-starts the Discord channel when a token is available (config first, env fallback) and `channels.discord.enabled` is not `false`.
   - If you prefer env vars, set `DISCORD_BOT_TOKEN` (a config block is optional).
5. Direct chats: use `user:<id>` (or a `<@id>` mention) when delivering; all turns land in the shared `main` session. Bare numeric IDs are ambiguous and rejected.
6. Guild channels: use `channel:<channelId>` for delivery. Mentions are required by default and can be set per guild or per channel.
7. Direct chats: secure by default via `channels.discord.dm.policy` (default: `"pairing"`). Unknown senders get a pairing code (expires after 1 hour); approve via `verso pairing approve discord <code>`.
   - To keep old “open to anyone” behavior: set `channels.discord.dm.policy="open"` and `channels.discord.dm.allowFrom=["*"]`.
   - To hard-allowlist: set `channels.discord.dm.policy="allowlist"` and list senders in `channels.discord.dm.allowFrom`.
   - To ignore all DMs: set `channels.discord.dm.enabled=false` or `channels.discord.dm.policy="disabled"`.
8. Group DMs are ignored by default; enable via `channels.discord.dm.groupEnabled` and optionally restrict by `channels.discord.dm.groupChannels`.
9. Optional guild rules: set `channels.discord.guilds` keyed by guild id (preferred) or slug, with per-channel rules.
10. Optional native commands: `commands.native` defaults to `"auto"` (on for Discord/Telegram, off for Slack). Override with `channels.discord.commands.native: true|false|"auto"`; `false` clears previously registered commands. Text commands are controlled by `commands.text` and must be sent as standalone `/...` messages. Use `commands.useAccessGroups: false` to bypass access-group checks for commands.
    - Full command list + config: [Slash commands](/tools/slash-commands)
11. Optional guild context history: set `channels.discord.historyLimit` (default 20, falls back to `messages.groupChat.historyLimit`) to include the last N guild messages as context when replying to a mention. Set `0` to disable.
12. Reactions: the agent can trigger reactions via the `discord` tool (gated by `channels.discord.actions.*`).
    - Reaction removal semantics: see [/tools/reactions](/tools/reactions).
    - The `discord` tool is only exposed when the current channel is Discord.
13. Native commands use isolated session keys (`agent:<agentId>:discord:slash:<userId>`) rather than the shared `main` session.

Note: Name → id resolution uses guild member search and requires Server Members Intent; if the bot can’t search members, use ids or `<@id>` mentions.
Note: Slugs are lowercase with spaces replaced by `-`. Channel names are slugged without the leading `#`.
Note: Guild context `[from:]` lines include `author.tag` + `id` to make ping-ready replies easy.

## Config writes

By default, Discord is allowed to write config updates triggered by `/config set|unset` (requires `commands.config: true`).

Disable with:

```json5
{
  channels: { discord: { configWrites: false } },
}
```

## How to create your own bot

This is the “Discord Developer Portal” setup for running Verso in a server (guild) channel like `#help`.

### 1) Create the Discord app + bot user

1. Discord Developer Portal → **Applications** → **New Application**
2. In your app:
   - **Bot** → **Add Bot**
   - Copy the **Bot Token** (this is what you put in `DISCORD_BOT_TOKEN`)

<<<<<<< HEAD

### 2) Enable the gateway intents Verso needs
