---
summary: "WhatsApp (web channel) integration: login, inbox, replies, media, and ops"
read_when:
  - Working on WhatsApp/web channel behavior or inbox routing
title: "WhatsApp"
---

# WhatsApp (web channel)

Status: WhatsApp Web via Baileys only. Gateway owns the session(s).

## Quick setup (beginner)

1. Use a **separate phone number** if possible (recommended).
2. Configure WhatsApp in `~/.verso/verso.json`.
3. Run `verso channels login` to scan the QR code (Linked Devices).
4. # Start the gateway.

1) Use a **separate phone number** if possible (recommended).
2) Configure WhatsApp in `~/.openclaw/openclaw.json`.
3) Run `openclaw channels login` to scan the QR code (Linked Devices).
4) Start the gateway.
   > > > > > > > upstream/main

Minimal config:

```json5
{
  channels: {
    whatsapp: {
      dmPolicy: "allowlist",
      allowFrom: ["+15551234567"],
    },
  },
}
```

## Goals

- Multiple WhatsApp accounts (multi-account) in one Gateway process.
- Deterministic routing: replies return to WhatsApp, no model routing.
- Model sees enough context to understand quoted replies.

## Config writes

By default, WhatsApp is allowed to write config updates triggered by `/config set|unset` (requires `commands.config: true`).

Disable with:

```json5
{
  channels: { whatsapp: { configWrites: false } },
}
```

## Architecture (who owns what)

- **Gateway** owns the Baileys socket and inbox loop.
- **CLI / macOS app** talk to the gateway; no direct Baileys use.
- **Active listener** is required for outbound sends; otherwise send fails fast.

## Getting a phone number (two modes)

WhatsApp requires a real mobile number for verification. VoIP and virtual numbers are usually blocked. There are two supported ways to run Verso on WhatsApp:

### Dedicated number (recommended)

Use a **separate phone number** for Verso. Best UX, clean routing, no self-chat quirks. Ideal setup: **spare/old Android phone + eSIM**. Leave it on Wi‑Fi and power, and link it via QR.

# **WhatsApp Business:** You can use WhatsApp Business on the same device with a different number. Great for keeping your personal WhatsApp separate — install WhatsApp Business and register the Verso number there.

WhatsApp requires a real mobile number for verification. VoIP and virtual numbers are usually blocked. There are two supported ways to run Verso on WhatsApp:

### Dedicated number (recommended)

Use a **separate phone number** for Verso. Best UX, clean routing, no self-chat quirks. Ideal setup: **spare/old Android phone + eSIM**. Leave it on Wi‑Fi and power, and link it via QR.

**WhatsApp Business:** You can use WhatsApp Business on the same device with a different number. Great for keeping your personal WhatsApp separate — install WhatsApp Business and register the Verso number there.

> > > > > > > upstream/main

**Sample config (dedicated number, single-user allowlist):**

```json5
{
  channels: {
    whatsapp: {
      dmPolicy: "allowlist",
      allowFrom: ["+15551234567"],
    },
  },
}
```

**Pairing mode (optional):**
If you want pairing instead of allowlist, set `channels.whatsapp.dmPolicy` to `pairing`. Unknown senders get a pairing code; approve with:
<<<<<<< HEAD
`verso pairing approve whatsapp <code>`

### Personal number (fallback)

# Quick fallback: run Verso on **your own number**. Message yourself (WhatsApp “Message yourself”) for testing so you don’t spam contacts. Expect to read verification codes on your main phone during setup and experiments. **Must enable self-chat mode.**

`openclaw pairing approve whatsapp <code>`

### Personal number (fallback)

Quick fallback: run Verso on **your own number**. Message yourself (WhatsApp “Message yourself”) for testing so you don’t spam contacts. Expect to read verification codes on your main phone during setup and experiments. **Must enable self-chat mode.**

> > > > > > > upstream/main
> > > > > > > When the wizard asks for your personal WhatsApp number, enter the phone you will message from (the owner/sender), not the assistant number.

**Sample config (personal number, self-chat):**

```json
{
  "whatsapp": {
    "selfChatMode": true,
    "dmPolicy": "allowlist",
    "allowFrom": ["+15551234567"]
  }
}
```

Self-chat replies default to `[{identity.name}]` when set (otherwise `[verso]`)
if `messages.responsePrefix` is unset. Set it explicitly to customize or disable
the prefix (use `""` to remove it).

### Number sourcing tips

- **Local eSIM** from your country's mobile carrier (most reliable)
  - Austria: [hot.at](https://www.hot.at)
  - UK: [giffgaff](https://www.giffgaff.com) — free SIM, no contract
- **Prepaid SIM** — cheap, just needs to receive one SMS for verification

**Avoid:** TextNow, Google Voice, most "free SMS" services — WhatsApp blocks these aggressively.

**Tip:** The number only needs to receive one verification SMS. After that, WhatsApp Web sessions persist via `creds.json`.

## Why Not Twilio?

<<<<<<< HEAD

- # Early Verso builds supported Twilio’s WhatsApp Business integration.

- Early Verso builds supported Twilio’s WhatsApp Business integration.
  > > > > > > > upstream/main
- WhatsApp Business numbers are a poor fit for a personal assistant.
- Meta enforces a 24‑hour reply window; if you haven’t responded in the last 24 hours, the business number can’t initiate new messages.
- High-volume or “chatty” usage triggers aggressive blocking, because business accounts aren’t meant to send dozens of personal assistant messages.
- Result: unreliable delivery and frequent blocks, so support was removed.

## Login + credentials

<<<<<<< HEAD

- Login command: `verso channels login` (QR via Linked Devices).
- Multi-account login: `verso channels login --account <id>` (`<id>` = `accountId`).
- Default account (when `--account` is omitted): `default` if present, otherwise the first configured account id (sorted).
- Credentials stored in `~/.verso/credentials/whatsapp/<accountId>/creds.json`.
- Backup copy at `creds.json.bak` (restored on corruption).
- Legacy compatibility: older installs stored Baileys files directly in `~/.verso/credentials/`.
- # Logout: `verso channels logout` (or `--account <id>`) deletes WhatsApp auth state (but keeps shared `oauth.json`).

- Login command: `openclaw channels login` (QR via Linked Devices).
- Multi-account login: `openclaw channels login --account <id>` (`<id>` = `accountId`).
- Default account (when `--account` is omitted): `default` if present, otherwise the first configured account id (sorted).
- Credentials stored in `~/.openclaw/credentials/whatsapp/<accountId>/creds.json`.
- Backup copy at `creds.json.bak` (restored on corruption).
- Legacy compatibility: older installs stored Baileys files directly in `~/.openclaw/credentials/`.
- Logout: `openclaw channels logout` (or `--account <id>`) deletes WhatsApp auth state (but keeps shared `oauth.json`).
  > > > > > > > upstream/main
- Logged-out socket => error instructs re-link.

## Inbound flow (DM + group)

- WhatsApp events come from `messages.upsert` (Baileys).
- Inbox listeners are detached on shutdown to avoid accumulating event handlers in tests/restarts.
- Status/broadcast chats are ignored.
- Direct chats use E.164; groups use group JID.
- **DM policy**: `channels.whatsapp.dmPolicy` controls direct chat access (default: `pairing`).
  - Pairing: unknown senders get a pairing code (approve via `verso pairing approve whatsapp <code>`; codes expire after 1 hour).
  - Open: requires `channels.whatsapp.allowFrom` to include `"*"`.
  - Your linked WhatsApp number is implicitly trusted, so self messages skip ⁠`channels.whatsapp.dmPolicy` and `channels.whatsapp.allowFrom` checks.

### Personal-number mode (fallback)

<<<<<<< HEAD
If you run Verso on your **personal WhatsApp number**, enable `channels.whatsapp.selfChatMode` (see sample above).
