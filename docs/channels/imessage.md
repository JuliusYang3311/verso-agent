---
summary: "Legacy iMessage support via imsg (JSON-RPC over stdio). New setups should use BlueBubbles."
read_when:
  - Setting up iMessage support
  - Debugging iMessage send/receive
title: iMessage
---

# iMessage (legacy: imsg)

> **Recommended:** Use [BlueBubbles](/channels/bluebubbles) for new iMessage setups.
>
> The `imsg` channel is a legacy external-CLI integration and may be removed in a future release.

Status: legacy external CLI integration. Gateway spawns `imsg rpc` (JSON-RPC over stdio).

## Quick setup (beginner)

1. Ensure Messages is signed in on this Mac.
2. Install `imsg`:
   - `brew install steipete/tap/imsg`

3) Configure Verso with `channels.imessage.cliPath` and `channels.imessage.dbPath`.
4) Start the gateway and approve any macOS prompts (Automation + Full Disk Access).

Minimal config:

```json5
{
  channels: {
    imessage: {
      enabled: true,
      cliPath: "/usr/local/bin/imsg",
      dbPath: "/Users/<you>/Library/Messages/chat.db",
    },
  },
}
```

## What it is

- iMessage channel backed by `imsg` on macOS.
- Deterministic routing: replies always go back to iMessage.
- DMs share the agent's main session; groups are isolated (`agent:<agentId>:imessage:group:<chat_id>`).
- If a multi-participant thread arrives with `is_group=false`, you can still isolate it by `chat_id` using `channels.imessage.groups` (see “Group-ish threads” below).

## Config writes

By default, iMessage is allowed to write config updates triggered by `/config set|unset` (requires `commands.config: true`).

Disable with:

```json5
{
  channels: { imessage: { configWrites: false } },
}
```

## Requirements

- macOS with Messages signed in.
- Full Disk Access for Verso + `imsg` (Messages DB access).
- Automation permission when sending.
- `channels.imessage.cliPath` can point to any command that proxies stdin/stdout (for example, a wrapper script that SSHes to another Mac and runs `imsg rpc`).

## Troubleshooting macOS Privacy and Security TCC

If sending/receiving fails (for example, `imsg rpc` exits non-zero, times out, or the gateway appears to hang), a common cause is a macOS permission prompt that was never approved.

macOS grants TCC permissions per app/process context. Approve prompts in the same context that runs `imsg` (for example, Terminal/iTerm, a LaunchAgent session, or an SSH-launched process).

Checklist:

- **Full Disk Access**: allow access for the process running Verso (and any shell/SSH wrapper that executes `imsg`). This is required to read the Messages database (`chat.db`).
- **Automation → Messages**: allow the process running Verso (and/or your terminal) to control **Messages.app** for outbound sends.
- **`imsg` CLI health**: verify `imsg` is installed and supports RPC (`imsg rpc --help`).

Tip: If Verso is running headless (LaunchAgent/systemd/SSH) the macOS prompt can be easy to miss. Run a one-time interactive command in a GUI terminal to force the prompt, then retry:

```bash
imsg chats --limit 1
# or
imsg send <handle> "test"
```

Related macOS folder permissions (Desktop/Documents/Downloads): [/platforms/mac/permissions](/platforms/mac/permissions).

## Setup (fast path)

1. Ensure Messages is signed in on this Mac.
2. Configure iMessage and start the gateway.

### Dedicated bot macOS user (for isolated identity)

If you want the bot to send from a **separate iMessage identity** (and keep your personal Messages clean), use a dedicated Apple ID + a dedicated macOS user.

1. Create a dedicated Apple ID (example: `my-cool-bot@icloud.com`).
   - Apple may require a phone number for verification / 2FA.

2) Create a macOS user (example: `versoshome`) and sign into it.
3) Open Messages in that macOS user and sign into iMessage using the bot Apple ID.
4) Enable Remote Login (System Settings → General → Sharing → Remote Login).
5) Install `imsg`:
   - `brew install steipete/tap/imsg`

6. Set up SSH so `ssh <bot-macos-user>@localhost true` works without a password.
7. Point `channels.imessage.accounts.bot.cliPath` at an SSH wrapper that runs `imsg` as the bot user.

First-run note: sending/receiving may require GUI approvals (Automation + Full Disk Access) in the _bot macOS user_. If `imsg rpc` looks stuck or exits, log into that user (Screen Sharing helps), run a one-time `imsg chats --limit 1` / `imsg send ...`, approve prompts, then retry. See [Troubleshooting macOS Privacy and Security TCC](#troubleshooting-macos-privacy-and-security-tcc).

Example wrapper (`chmod +x`). Replace `<bot-macos-user>` with your actual macOS username:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Run an interactive SSH once first to accept host keys:
#   ssh <bot-macos-user>@localhost true
exec /usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=5 -T <bot-macos-user>@localhost \
  "/usr/local/bin/imsg" "$@"
```

Example config:

```json5
{
  channels: {
    imessage: {
      enabled: true,
      accounts: {
        bot: {
          name: "Bot",
          enabled: true,
          cliPath: "/path/to/imsg-bot",
          dbPath: "/Users/<bot-macos-user>/Library/Messages/chat.db",
        },
      },
    },
  },
}
```

For single-account setups, use flat options (`channels.imessage.cliPath`, `channels.imessage.dbPath`) instead of the `accounts` map.

### Remote/SSH variant (optional)

If you want iMessage on another Mac, set `channels.imessage.cliPath` to a wrapper that runs `imsg` on the remote macOS host over SSH. Verso only needs stdio.

````

Concrete config example (Tailscale hostname):

```json5
{
  channels: {
    imessage: {
      enabled: true,
      cliPath: "~/.verso/scripts/imsg-ssh",
      remoteHost: "bot@mac-mini.tailnet-1234.ts.net",
      includeAttachments: true,
      dbPath: "/Users/bot/Library/Messages/chat.db",
    },
  },
}
```

Example wrapper (`~/.verso/scripts/imsg-ssh`):
````
