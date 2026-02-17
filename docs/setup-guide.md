# Verso Setup Guide

From zero to running gateway — everything you need to get started.

## Prerequisites

| Requirement | Version            |
| ----------- | ------------------ |
| Node.js     | >= 22.12.0         |
| pnpm        | 10.23.0            |
| Git         | any recent version |

```bash
node --version   # v22.12.0+
pnpm --version   # 10.23.0
```

> If pnpm is not installed: `corepack enable && corepack prepare pnpm@10.23.0 --activate`

## 1. Clone & Install

```bash
git clone https://github.com/JuliusYang3311/verso-agent.git verso
cd verso
pnpm install
```

`pnpm install` will:

- Install all dependencies (including `@mariozechner/pi-agent-core`, `sqlite-vec`, channel SDKs)
- Create `node_modules/.bin/verso` and `node_modules/.bin/openclaw` symlinks (via postinstall)
- Set up git hooks (via prepare)

## 2. Build

```bash
pnpm build
```

This runs the full build pipeline:

1. **tsdown** — Bundle TypeScript source to `dist/` (ESM)
2. **tsc** — Generate plugin-sdk type definitions
3. **Post-build scripts** — Copy hook metadata, write build info, generate CLI compat shims

Verify the build:

```bash
ls dist/entry.js          # main entry point
ls dist/evolver/daemon-entry.js   # evolver daemon
```

## 3. Onboard (Interactive Setup)

```bash
pnpm verso onboard
```

Or if you prefer the quickstart flow:

```bash
pnpm verso onboard --flow quickstart
```

The wizard walks you through:

1. **Risk acknowledgement** — Security notice
2. **Auth setup** — Choose LLM provider and enter API key:
   - Anthropic (`ANTHROPIC_API_KEY`)
   - OpenAI (`OPENAI_API_KEY`)
   - OpenRouter (`OPENROUTER_API_KEY`)
   - Google Gemini (`GEMINI_API_KEY`)
   - xAI, Moonshot, Qianfan, etc.
3. **Model selection** — Primary LLM + embedding model
4. **Gateway configuration** — Port, bind address, auth token
5. **Channels** — Connect Telegram, Discord, Slack, WhatsApp, or Feishu
6. **Skills** — Choose from 65+ pluggable capabilities
7. **Finalization** — Daemon install, health check

> For advanced control: `pnpm verso onboard --flow advanced`

## 4. Configure (Manual / Post-Setup)

Edit config directly or use the interactive configurator:

```bash
pnpm verso configure
```

### Config file location

```
~/.verso/verso.json
```

### Minimal config example

```json5
{
  agents: {
    defaults: {
      workspace: "~/verso",
    },
  },
  models: {
    providers: {
      anthropic: {
        apiKey: "sk-ant-...",
      },
    },
  },
  gateway: {
    port: 8080,
    auth: {
      mode: "token",
      token: "your-secret-token",
    },
  },
}
```

### Environment variables

Variables can be set in three ways (highest precedence first):

1. **Shell environment** — `export ANTHROPIC_API_KEY=sk-ant-...`
2. **`.env` file** — In project root or `~/.verso/.env`
3. **Config `env` block** — In `verso.json`:

```json5
{
  env: {
    vars: {
      ANTHROPIC_API_KEY: "sk-ant-...",
      TELEGRAM_BOT_TOKEN: "123456:ABC...",
    },
  },
}
```

### Key environment variables

| Variable                              | Purpose                  |
| ------------------------------------- | ------------------------ |
| `ANTHROPIC_API_KEY`                   | Anthropic (Claude)       |
| `OPENAI_API_KEY`                      | OpenAI                   |
| `OPENROUTER_API_KEY`                  | OpenRouter (multi-model) |
| `GEMINI_API_KEY`                      | Google Gemini            |
| `TELEGRAM_BOT_TOKEN`                  | Telegram bot             |
| `DISCORD_BOT_TOKEN`                   | Discord bot              |
| `SLACK_BOT_TOKEN`                     | Slack bot                |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Feishu                   |

## 5. Start the Gateway

### Foreground (development)

```bash
pnpm verso gateway run
```

### As a system service (production)

```bash
# Install as launchd (macOS) / systemd (Linux) service
pnpm verso gateway install --port 8080 --token your-secret-token

# Then manage with:
pnpm verso gateway start
pnpm verso gateway stop
pnpm verso gateway restart
pnpm verso gateway status
```

### Verify it's running

```bash
pnpm verso gateway health
```

Open the Control UI in your browser: `http://localhost:8080`

## 6. Connect Channels

### Telegram

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Set `TELEGRAM_BOT_TOKEN` in config
3. Run `pnpm verso channels login --channel telegram`

### Discord

1. Create a bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. Set `DISCORD_BOT_TOKEN` in config
3. Invite bot to your server

### WhatsApp

1. Run `pnpm verso channels login --channel whatsapp`
2. Scan the QR code with your phone

### Slack

1. Create a Slack app at [api.slack.com](https://api.slack.com/apps)
2. Set `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`

### Feishu

1. Create an app at [Feishu Open Platform](https://open.feishu.cn)
2. Set `FEISHU_APP_ID` and `FEISHU_APP_SECRET`

## 7. Health Check & Diagnostics

```bash
# Full system health check
pnpm verso doctor

# Auto-fix issues
pnpm verso doctor --fix

# Deep scan (daemons, Docker, etc.)
pnpm verso doctor --deep
```

Doctor checks: config integrity, auth profiles, model catalog, gateway health, sandbox images, security audit, shell completion, and more.

## 8. Evolver (Self-Optimization)

The evolver runs as a background daemon that automatically optimizes the agent.

### Configuration

In `verso.json`:

```json5
{
  evolver: {
    review: true, // require human review before deploying changes
    // "review": false  // auto-deploy after sandbox validation
  },
}
```

### How it works

1. Extracts signals from conversations (slow responses, repeated questions, errors)
2. Selects optimization genes (context tuning, code fixes, prompt improvements)
3. Tests changes in sandbox (lint + build + test)
4. Deploys on success, rolls back on failure

### Logs

```
~/.verso/logs/evolver-daemon.log       # daemon output
~/.verso/logs/evolver-daemon.pid       # process ID
~/.verso/logs/evolver-daemon.rollback.json  # rollback info
```

## Directory Structure After Setup

```
~/.verso/
├── verso.json                # Main config
├── .env                      # Environment variables (optional)
├── logs/
│   ├── verso-YYYY-MM-DD.log  # Gateway logs (rolling)
│   ├── evolver-daemon.log    # Evolver logs
│   └── evolver-daemon.pid    # Evolver PID
└── ...

~/verso/                      # Workspace (configurable)
├── AGENT.md                  # Agent identity / personality
├── SOUL.md                   # Agent values / directives
├── MEMORY.md                 # Long-term memory
├── USER.md                   # User profile
├── memory/                   # Vector memory (sqlite-vec)
└── skills/                   # Installed skills
```

## Quick Reference

| Task           | Command                     |
| -------------- | --------------------------- |
| Install        | `pnpm install`              |
| Build          | `pnpm build`                |
| Onboard        | `pnpm verso onboard`        |
| Configure      | `pnpm verso configure`      |
| Start gateway  | `pnpm verso gateway start`  |
| Stop gateway   | `pnpm verso gateway stop`   |
| Gateway status | `pnpm verso gateway status` |
| Health check   | `pnpm verso doctor`         |
| View status    | `pnpm verso status`         |
| Run tests      | `pnpm test`                 |
| Lint           | `pnpm lint`                 |
| Update         | `pnpm verso update`         |

## Troubleshooting

### `command not found: verso`

Run `pnpm install` to create the bin symlink, or use `pnpm verso` instead.

### Build errors

```bash
pnpm build    # rebuild from scratch
```

### Memory test failures on CI

Ensure Node.js >= 22.12.0 with `node:sqlite` support. Use `check-latest: true` in CI.

### Evolver daemon not logging

Verify the daemon was built: `ls dist/evolver/daemon-entry.js`. If missing, run `pnpm build`.
