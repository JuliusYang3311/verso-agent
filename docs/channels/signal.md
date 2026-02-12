---
summary: "Signal support via signal-cli (JSON-RPC + SSE), setup, and number model"
read_when:
  - Setting up Signal support
  - Debugging Signal send/receive
title: "Signal"
---

# Signal (signal-cli)

Status: external CLI integration. Gateway talks to `signal-cli` over HTTP JSON-RPC + SSE.

## Quick setup (beginner)

1. Use a **separate Signal number** for the bot (recommended).
2. Install `signal-cli` (Java required).
3. Link the bot device and start the daemon:
   - `signal-cli link -n "Verso"`
4. # Configure Verso and start the gateway.

1) Use a **separate Signal number** for the bot (recommended).
2) Install `signal-cli` (Java required).
3) Link the bot device and start the daemon:
   - `signal-cli link -n "Verso"`
4) Configure Verso and start the gateway.
   > > > > > > > upstream/main

Minimal config:

```json5
{
  channels: {
    signal: {
      enabled: true,
      account: "+15551234567",
      cliPath: "signal-cli",
      dmPolicy: "pairing",
      allowFrom: ["+15557654321"],
    },
  },
}
```

## What it is

- Signal channel via `signal-cli` (not embedded libsignal).
- Deterministic routing: replies always go back to Signal.
- DMs share the agent's main session; groups are isolated (`agent:<agentId>:signal:group:<groupId>`).

## Config writes

By default, Signal is allowed to write config updates triggered by `/config set|unset` (requires `commands.config: true`).

Disable with:

```json5
{
  channels: { signal: { configWrites: false } },
}
```

## The number model (important)

- The gateway connects to a **Signal device** (the `signal-cli` account).
- If you run the bot on **your personal Signal account**, it will ignore your own messages (loop protection).
- For "I text the bot and it replies," use a **separate bot number**.

## Setup (fast path)

1. Install `signal-cli` (Java required).
2. Link a bot account:
   - `signal-cli link -n "Verso"` then scan the QR in Signal.
3. # Configure Signal and start the gateway.

1) Install `signal-cli` (Java required).
2) Link a bot account:
   - `signal-cli link -n "Verso"` then scan the QR in Signal.
3) Configure Signal and start the gateway.
   > > > > > > > upstream/main

Example:

```json5
{
  channels: {
    signal: {
      enabled: true,
      account: "+15551234567",
      cliPath: "signal-cli",
      dmPolicy: "pairing",
      allowFrom: ["+15557654321"],
    },
  },
}
```

Multi-account support: use `channels.signal.accounts` with per-account config and optional `name`. See [`gateway/configuration`](/gateway/configuration#telegramaccounts--discordaccounts--slackaccounts--signalaccounts--imessageaccounts) for the shared pattern.

## External daemon mode (httpUrl)

<<<<<<< HEAD
If you want to manage `signal-cli` yourself (slow JVM cold starts, container init, or shared CPUs), run the daemon separately and point Verso at it:
