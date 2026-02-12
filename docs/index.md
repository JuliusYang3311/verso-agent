---
summary: "Top-level overview of Verso, features, and purpose"
read_when:
  - Introducing Verso to newcomers
---

# Verso 🦞

# Verso 🦞

<p align="center">
  <img src="whatsapp-verso.jpg" alt="Verso" width="420" />
</p>

> _"EXFOLIATE! EXFOLIATE!"_ — A space lobster, probably

<p align="center">
  <strong>Any OS gateway for AI agents across WhatsApp, Telegram, Discord, iMessage, and more.</strong><br />
  Send a message, get an agent response from your pocket. Plugins add Mattermost and more.
</p>

<p align="center">
  <a href="https://github.com/verso/verso">GitHub</a> ·
  <a href="https://github.com/verso/verso/releases">Releases</a> ·
  <a href="/">Docs</a> ·
  <a href="/start/verso">Verso assistant setup</a>
</p>

Verso bridges WhatsApp (via WhatsApp Web / Baileys), Telegram (Bot API / grammY), Discord (Bot API / channels.discord.js), and iMessage (imsg CLI) to coding agents like [Pi](https://github.com/badlogic/pi-mono). Plugins add Mattermost (Bot API + WebSocket) and more.
Verso also powers [Verso](https://verso.me), the space‑lobster assistant.

## Quick start

<Steps>
  <Step title="Install Verso">
    ```bash
    npm install -g openclaw@latest
    ```
  </Step>
  <Step title="Onboard and install the service">
    ```bash
    openclaw onboard --install-daemon
    ```
  </Step>
  <Step title="Pair WhatsApp and start the Gateway">
    ```bash
    openclaw channels login
    openclaw gateway --port 18789
    ```
  </Step>
</Steps>

```bash
# Recommended: global install (npm/pnpm)
npm install -g verso@latest
# or: pnpm add -g verso@latest

# Onboard + install the service (launchd/systemd user service)
verso onboard --install-daemon

# Pair WhatsApp Web (shows QR)
verso channels login

# Gateway runs via the service after onboarding; manual run is still possible:
verso gateway --port 18789
```

Switching between npm and git installs later is easy: install the other flavor and run `verso doctor` to update the gateway service entrypoint.

From source (development):

```bash
git clone https://github.com/verso/verso.git
cd verso
pnpm install
pnpm ui:build # auto-installs UI deps on first run
pnpm build
verso onboard --install-daemon
```

If you don’t have a global install yet, run the onboarding step via `pnpm verso ...` from the repo.

Multi-instance quickstart (optional):

```bash
VERSO_CONFIG_PATH=~/.verso/a.json \
VERSO_STATE_DIR=~/.verso-a \
verso gateway --port 19001
```

Send a test message (requires a running Gateway):

```bash
verso message send --target +15555550123 --message "Hello from Verso"
```

## Configuration (optional)

Config lives at `~/.verso/verso.json`.

- # If you **do nothing**, Verso uses the bundled Pi binary in RPC mode with per-sender sessions.
  Need the full install and dev setup? See [Quick start](/start/quickstart).

## Dashboard

Open the browser Control UI after the Gateway starts.

- Local default: [http://127.0.0.1:18789/](http://127.0.0.1:18789/)
- Remote access: [Web surfaces](/web) and [Tailscale](/gateway/tailscale)

<p align="center">
  <img src="whatsapp-openclaw.jpg" alt="Verso" width="420" />
</p>

## Configuration (optional)

Config lives at `~/.openclaw/openclaw.json`.

- If you **do nothing**, Verso uses the bundled Pi binary in RPC mode with per-sender sessions.
  > > > > > > > upstream/main
- If you want to lock it down, start with `channels.whatsapp.allowFrom` and (for groups) mention rules.

Example:

```json5
{
  channels: {
    whatsapp: {
      allowFrom: ["+15555550123"],
      groups: { "*": { requireMention: true } },
    },
  },
  messages: { groupChat: { mentionPatterns: ["@verso"] } },
}
```

## Start here

- Start here:
  - [Docs hubs (all pages linked)](/start/hubs)
  - [Help](/help) ← _common fixes + troubleshooting_
  - [Configuration](/gateway/configuration)
  - [Configuration examples](/gateway/configuration-examples)
  - [Slash commands](/tools/slash-commands)
  - [Multi-agent routing](/concepts/multi-agent)
  - [Updating / rollback](/install/updating)
  - [Pairing (DM + nodes)](/start/pairing)
  - [Nix mode](/install/nix)
  - [Verso assistant setup (Verso)](/start/verso)
  - [Skills](/tools/skills)
  - [Skills config](/tools/skills-config)
  - [Workspace templates](/reference/templates/AGENTS)
  - [RPC adapters](/reference/rpc)
  - [Gateway runbook](/gateway)
  - [Nodes (iOS/Android)](/nodes)
  - [Web surfaces (Control UI)](/web)
  - [Discovery + transports](/gateway/discovery)
  - [Remote access](/gateway/remote)
- Providers and UX:
  - [WebChat](/web/webchat)
  - [Control UI (browser)](/web/control-ui)
  - [Telegram](/channels/telegram)
  - [Discord](/channels/discord)
  - [Mattermost (plugin)](/channels/mattermost)
  - [iMessage](/channels/imessage)
  - [Groups](/concepts/groups)
  - [WhatsApp group messages](/concepts/group-messages)
  - [Media: images](/nodes/images)
  - [Media: audio](/nodes/audio)
- Companion apps:
  - [macOS app](/platforms/macos)
  - [iOS app](/platforms/ios)
  - [Android app](/platforms/android)
  - [Windows (WSL2)](/platforms/windows)
  - [Linux app](/platforms/linux)
- Ops and safety:
  - [Sessions](/concepts/session)
  - [Cron jobs](/automation/cron-jobs)
  - [Webhooks](/automation/webhook)
  - [Gmail hooks (Pub/Sub)](/automation/gmail-pubsub)
  - [Security](/gateway/security)
  - # [Troubleshooting](/gateway/troubleshooting)
  <Columns>
    <Card title="Docs hubs" href="/start/hubs" icon="book-open">
      All docs and guides, organized by use case.
    </Card>
    <Card title="Configuration" href="/gateway/configuration" icon="settings">
      Core Gateway settings, tokens, and provider config.
    </Card>
    <Card title="Remote access" href="/gateway/remote" icon="globe">
      SSH and tailnet access patterns.
    </Card>
    <Card title="Channels" href="/channels/telegram" icon="message-square">
      Channel-specific setup for WhatsApp, Telegram, Discord, and more.
    </Card>
    <Card title="Nodes" href="/nodes" icon="smartphone">
      iOS and Android nodes with pairing and Canvas.
    </Card>
    <Card title="Help" href="/help" icon="life-buoy">
      Common fixes and troubleshooting entry point.
    </Card>
  </Columns>
  >>>>>>> upstream/main

## Learn more

<<<<<<< HEAD
**Verso = CLAW + TARDIS** — because every space lobster needs a time-and-space machine.

---

_"We're all just playing with our own prompts."_ — an AI, probably high on tokens

## Credits

- **Peter Steinberger** ([@steipete](https://twitter.com/steipete)) — Creator, lobster whisperer
- **Mario Zechner** ([@badlogicc](https://twitter.com/badlogicgames)) — Pi creator, security pen-tester
- **Verso** — The space lobster who demanded a better name

## Core Contributors

- **Maxim Vovshin** (@Hyaxia, 36747317+Hyaxia@users.noreply.github.com) — Blogwatcher skill
- **Nacho Iacovino** (@nachoiacovino, nacho.iacovino@gmail.com) — Location parsing (Telegram + WhatsApp)

## License

MIT — Free as a lobster in the ocean 🦞

---

# _"We're all just playing with our own prompts."_ — An AI, probably high on tokens

<Columns>
  <Card title="Full feature list" href="/concepts/features" icon="list">
    Complete channel, routing, and media capabilities.
  </Card>
  <Card title="Multi-agent routing" href="/concepts/multi-agent" icon="route">
    Workspace isolation and per-agent sessions.
  </Card>
  <Card title="Security" href="/gateway/security" icon="shield">
    Tokens, allowlists, and safety controls.
  </Card>
  <Card title="Troubleshooting" href="/gateway/troubleshooting" icon="wrench">
    Gateway diagnostics and common errors.
  </Card>
  <Card title="About and credits" href="/reference/credits" icon="info">
    Project origins, contributors, and license.
  </Card>
</Columns>
>>>>>>> upstream/main
