---
summary: "Telegram bot support status, capabilities, and configuration"
read_when:
  - Working on Telegram features or webhooks
title: "Telegram"
---

# Telegram (Bot API)

Status: production-ready for bot DMs + groups via grammY. Long-polling by default; webhook optional.

## Quick setup (beginner)

1. Create a bot with **@BotFather** ([direct link](https://t.me/BotFather)). Confirm the handle is exactly `@BotFather`, then copy the token.
2. Set the token:
   - Env: `TELEGRAM_BOT_TOKEN=...`
   - Or config: `channels.telegram.botToken: "..."`.
   - If both are set, config takes precedence (env fallback is default-account only).
3. Start the gateway.
4. DM access is pairing by default; approve the pairing code on first contact.

Minimal config:

```json5
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "123:abc",
      dmPolicy: "pairing",
    },
  },
}
```

## What it is

- A Telegram Bot API channel owned by the Gateway.
- Deterministic routing: replies go back to Telegram; the model never chooses channels.
- DMs share the agent's main session; groups stay isolated (`agent:<agentId>:telegram:group:<chatId>`).

## Setup (fast path)

### 1) Create a bot token (BotFather)

1. Open Telegram and chat with **@BotFather** ([direct link](https://t.me/BotFather)). Confirm the handle is exactly `@BotFather`.
2. Run `/newbot`, then follow the prompts (name + username ending in `bot`).
3. Copy the token and store it safely.

Optional BotFather settings:

- `/setjoingroups` — allow/deny adding the bot to groups.
- `/setprivacy` — control whether the bot sees all group messages.

### 2) Configure the token (env or config)

Example:

```json5
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "123:abc",
      dmPolicy: "pairing",
      groups: { "*": { requireMention: true } },
    },
  },
}
```

Env option: `TELEGRAM_BOT_TOKEN=...` (works for the default account).
If both env and config are set, config takes precedence.

Multi-account support: use `channels.telegram.accounts` with per-account tokens and optional `name`. See [`gateway/configuration`](/gateway/configuration#telegramaccounts--discordaccounts--slackaccounts--signalaccounts--imessageaccounts) for the shared pattern.

3. Start the gateway. Telegram starts when a token is resolved (config first, env fallback).
4. DM access defaults to pairing. Approve the code when the bot is first contacted.
5. For groups: add the bot, decide privacy/admin behavior (below), then set `channels.telegram.groups` to control mention gating + allowlists.

## Token + privacy + permissions (Telegram side)

### Token creation (BotFather)

- `/newbot` creates the bot and returns the token (keep it secret).
- If a token leaks, revoke/regenerate it via @BotFather and update your config.

### Group message visibility (Privacy Mode)

Telegram bots default to **Privacy Mode**, which limits which group messages they receive.
If your bot must see _all_ group messages, you have two options:

- Disable privacy mode with `/setprivacy` **or**
- Add the bot as a group **admin** (admin bots receive all messages).

**Note:** When you toggle privacy mode, Telegram requires removing + re‑adding the bot
to each group for the change to take effect.

### Group permissions (admin rights)

Admin status is set inside the group (Telegram UI). Admin bots always receive all
group messages, so use admin if you need full visibility.

## How it works (behavior)

- Inbound messages are normalized into the shared channel envelope with reply context and media placeholders.
- Group replies require a mention by default (native @mention or `agents.list[].groupChat.mentionPatterns` / `messages.groupChat.mentionPatterns`).
- Multi-agent override: set per-agent patterns on `agents.list[].groupChat.mentionPatterns`.
- Replies always route back to the same Telegram chat.
- Long-polling uses grammY runner with per-chat sequencing; overall concurrency is capped by `agents.defaults.maxConcurrent`.
- Telegram Bot API does not support read receipts; there is no `sendReadReceipts` option.

## Draft streaming

Verso can stream partial replies in Telegram DMs using `sendMessageDraft`.

Requirements:

- Threaded Mode enabled for the bot in @BotFather (forum topic mode).
- Private chat threads only (Telegram includes `message_thread_id` on inbound messages).
- `channels.telegram.streamMode` not set to `"off"` (default: `"partial"`, `"block"` enables chunked draft updates).

Draft streaming is DM-only; Telegram does not support it in groups or channels.

## Formatting (Telegram HTML)

- Outbound Telegram text uses `parse_mode: "HTML"` (Telegram’s supported tag subset).
- Markdown-ish input is rendered into **Telegram-safe HTML** (bold/italic/strike/code/links); block elements are flattened to text with newlines/bullets.
- Raw HTML from models is escaped to avoid Telegram parse errors.
- If Telegram rejects the HTML payload, Verso retries the same message as plain text.

## Commands (native + custom)

# Verso registers native commands (like `/status`, `/reset`, `/model`) with Telegram’s bot menu on startup.

- If Telegram rejects the HTML payload, Verso retries the same message as plain text.

## Commands (native + custom)

Verso registers native commands (like `/status`, `/reset`, `/model`) with Telegram’s bot menu on startup.

> > > > > > > upstream/main
> > > > > > > You can add custom commands to the menu via config:

```json5
{
  channels: {
    telegram: {
      customCommands: [
        { command: "backup", description: "Git backup" },
        { command: "generate", description: "Create an image" },
      ],
    },
  },
}
```

## Setup troubleshooting (commands)

- `setMyCommands failed` in logs usually means outbound HTTPS/DNS is blocked to `api.telegram.org`.
- If you see `sendMessage` or `sendChatAction` failures, check IPv6 routing and DNS.

More help: [Channel troubleshooting](/channels/troubleshooting).

Notes:

- # Custom commands are **menu entries only**; Verso does not implement them unless you handle them elsewhere.

- Custom commands are **menu entries only**; Verso does not implement them unless you handle them elsewhere.
- Some commands can be handled by plugins/skills without being registered in Telegram’s command menu. These still work when typed (they just won't show up in `/commands` / the menu).
  > > > > > > > upstream/main
- Command names are normalized (leading `/` stripped, lowercased) and must match `a-z`, `0-9`, `_` (1–32 chars).
- Custom commands **cannot override native commands**. Conflicts are ignored and logged.
- If `commands.native` is disabled, only custom commands are registered (or cleared if none).

### Device pairing commands (`device-pair` plugin)

If the `device-pair` plugin is installed, it adds a Telegram-first flow for pairing a new phone:

1. `/pair` generates a setup code (sent as a separate message for easy copy/paste).
2. Paste the setup code in the iOS app to connect.
3. `/pair approve` approves the latest pending device request.

More details: [Pairing](/channels/pairing#pair-via-telegram-recommended-for-ios).

## Limits

- Outbound text is chunked to `channels.telegram.textChunkLimit` (default 4000).
- Optional newline chunking: set `channels.telegram.chunkMode="newline"` to split on blank lines (paragraph boundaries) before length chunking.
- Media downloads/uploads are capped by `channels.telegram.mediaMaxMb` (default 5).
- Telegram Bot API requests time out after `channels.telegram.timeoutSeconds` (default 500 via grammY). Set lower to avoid long hangs.
- Group history context uses `channels.telegram.historyLimit` (or `channels.telegram.accounts.*.historyLimit`), falling back to `messages.groupChat.historyLimit`. Set `0` to disable (default 50).
- DM history can be limited with `channels.telegram.dmHistoryLimit` (user turns). Per-user overrides: `channels.telegram.dms["<user_id>"].historyLimit`.

## Group activation modes

By default, the bot only responds to mentions in groups (`@botname` or patterns in `agents.list[].groupChat.mentionPatterns`). To change this behavior:

### Via config (recommended)

```json5
{
  channels: {
    telegram: {
      groups: {
        "-1001234567890": { requireMention: false }, // always respond in this group
      },
    },
  },
}
```

**Important:** Setting `channels.telegram.groups` creates an **allowlist** - only listed groups (or `"*"`) will be accepted.
Forum topics inherit their parent group config (allowFrom, requireMention, skills, prompts) unless you add per-topic overrides under `channels.telegram.groups.<groupId>.topics.<topicId>`.

To allow all groups with always-respond:

```json5
{
  channels: {
    telegram: {
      groups: {
        "*": { requireMention: false }, // all groups, always respond
      },
    },
  },
}
```

To keep mention-only for all groups (default behavior):

```json5
{
  channels: {
    telegram: {
      groups: {
        "*": { requireMention: true }, // or omit groups entirely
      },
    },
  },
}
```

### Via command (session-level)

Send in the group:

- `/activation always` - respond to all messages
- `/activation mention` - require mentions (default)

**Note:** Commands update session state only. For persistent behavior across restarts, use config.

### Getting the group chat ID

Forward any message from the group to `@userinfobot` or `@getidsbot` on Telegram to see the chat ID (negative number like `-1001234567890`).

**Tip:** For your own user ID, DM the bot and it will reply with your user ID (pairing message), or use `/whoami` once commands are enabled.

**Privacy note:** `@userinfobot` is a third-party bot. If you prefer, add the bot to the group, send a message, and use `verso logs --follow` to read `chat.id`, or use the Bot API `getUpdates`.

## Config writes

By default, Telegram is allowed to write config updates triggered by channel events or `/config set|unset`.

This happens when:
<<<<<<< HEAD

- # A group is upgraded to a supergroup and Telegram emits `migrate_to_chat_id` (chat ID changes). Verso can migrate `channels.telegram.groups` automatically.

- A group is upgraded to a supergroup and Telegram emits `migrate_to_chat_id` (chat ID changes). Verso can migrate `channels.telegram.groups` automatically.
  > > > > > > > upstream/main
- You run `/config set` or `/config unset` in a Telegram chat (requires `commands.config: true`).

Disable with:

```json5
{
  channels: { telegram: { configWrites: false } },
}
```

## Topics (forum supergroups)

<<<<<<< HEAD
Telegram forum topics include a `message_thread_id` per message. Verso:
