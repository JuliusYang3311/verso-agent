---
summary: "First-run onboarding flow for Verso (macOS app)"
read_when:
  - Designing the macOS onboarding assistant
  - Implementing auth or identity setup
title: "Onboarding (macOS App)"
sidebarTitle: "Onboarding: macOS App"
---

# Onboarding (macOS App)

This doc describes the **current** first‑run onboarding flow. The goal is a
smooth “day 0” experience: pick where the Gateway runs, connect auth, run the
wizard, and let the agent bootstrap itself.

<Steps>
<Step title="Approve macOS warning">
<Frame>
<img src="/assets/macos-onboarding/01-macos-warning.jpeg" alt="" />
</Frame>
</Step>
<Step title="Approve find local networks">
<Frame>
<img src="/assets/macos-onboarding/02-local-networks.jpeg" alt="" />
</Frame>
</Step>
<Step title="Welcome and security notice">
<Frame caption="Read the security notice displayed and decide accordingly">
<img src="/assets/macos-onboarding/03-security-notice.png" alt="" />
</Frame>
</Step>
<Step title="Local vs Remote">
<Frame>
<img src="/assets/macos-onboarding/04-choose-gateway.png" alt="" />
</Frame>

Where does the **Gateway** run?

- **This Mac (Local only):** onboarding can run OAuth flows and write credentials
  locally.
- **Remote (over SSH/Tailnet):** onboarding does **not** run OAuth locally;
  credentials must exist on the gateway host.
- **Configure later:** skip setup and leave the app unconfigured.

<Tip>
**Gateway auth tip:**
- The wizard now generates a **token** even for loopback, so local WS clients must authenticate.
- If you disable auth, any local process can connect; use that only on fully trusted machines.
- Use a **token** for multi‑machine access or non‑loopback binds.

## 2) Local-only auth (Anthropic OAuth)

The macOS app supports Anthropic OAuth (Claude Pro/Max). The flow:

- Opens the browser for OAuth (PKCE)
- Asks the user to paste the `code#state` value
- Writes credentials to `~/.verso/credentials/oauth.json`

Other providers (OpenAI, custom APIs) are configured via environment variables
or config files for now.

## 3) Setup Wizard (Gateway‑driven)

The app can run the same setup wizard as the CLI. This keeps onboarding in sync
with Gateway‑side behavior and avoids duplicating logic in SwiftUI.

## 4) Permissions

Onboarding requests TCC permissions needed for:

- Automation (AppleScript)
- Notifications
- Accessibility
- Screen Recording
- Microphone
- Speech Recognition
- Camera
- Location

## 5) CLI (optional)

The app can install the global `verso` CLI via npm/pnpm so terminal
workflows and launchd tasks work out of the box.

## 6) Onboarding chat (dedicated session)

After setup, the app opens a dedicated onboarding chat session so the agent can
introduce itself and guide next steps. This keeps first‑run guidance separate
from your normal conversation.

## Agent bootstrap ritual

On the first agent run, Verso bootstraps a workspace (default `~/verso`):

- Seeds `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `USER.md`
- Runs a short Q&A ritual (one question at a time)
- Writes identity + preferences to `IDENTITY.md`, `USER.md`, `SOUL.md`
- Removes `BOOTSTRAP.md` when finished so it only runs once

## Optional: Gmail hooks (manual)

Gmail Pub/Sub setup is currently a manual step. Use:

```bash
verso webhooks gmail setup --account you@gmail.com
```

See [/automation/gmail-pubsub](/automation/gmail-pubsub) for details.

## Remote mode notes

When the Gateway runs on another machine, credentials and workspace files live
**on that host**. If you need OAuth in remote mode, create:

- `~/.verso/credentials/oauth.json`
- `~/.verso/agents/<agentId>/agent/auth-profiles.json`

# on the gateway host.

</Step>
<Step title="CLI">
  <Info>This step is optional</Info>
  The app can install the global `openclaw` CLI via npm/pnpm so terminal
  workflows and launchd tasks work out of the box.
</Step>
<Step title="Onboarding Chat (dedicated session)">
  After setup, the app opens a dedicated onboarding chat session so the agent can
  introduce itself and guide next steps. This keeps first‑run guidance separate
  from your normal conversation. See [Bootstrapping](/start/bootstrapping) for
  what happens on the gateway host during the first agent run.
</Step>
</Steps>
>>>>>>> upstream/main
