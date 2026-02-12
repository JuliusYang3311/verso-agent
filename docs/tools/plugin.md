---
summary: "Verso plugins/extensions: discovery, config, and safety"
read_when:
  - Adding or modifying plugins/extensions
  - Documenting plugin install or load rules
title: "Plugins"
---

# Plugins (Extensions)

## Quick start (new to plugins?)

A plugin is just a **small code module** that extends Verso with extra
features (commands, tools, and Gateway RPC).

Most of the time, you’ll use plugins when you want a feature that’s not built
into core Verso yet (or you want to keep optional features out of your main
install).

Fast path:

1. See what’s already loaded:

```bash
verso plugins list
```

2. Install an official plugin (example: Voice Call):

```bash
verso plugins install @verso/voice-call
```

3. Restart the Gateway, then configure under `plugins.entries.<id>.config`.

See [Voice Call](/plugins/voice-call) for a concrete example plugin.

## Available plugins (official)

- Microsoft Teams is plugin-only as of 2026.1.15; install `@verso/msteams` if you use Teams.
- Memory (Core) — bundled memory search plugin (enabled by default via `plugins.slots.memory`)
- Memory (LanceDB) — bundled long-term memory plugin (auto-recall/capture; set `plugins.slots.memory = "memory-lancedb"`)
- [Voice Call](/plugins/voice-call) — `@verso/voice-call`
- [Zalo Personal](/plugins/zalouser) — `@verso/zalouser`
- [Matrix](/channels/matrix) — `@verso/matrix`
- [Nostr](/channels/nostr) — `@verso/nostr`
- [Zalo](/channels/zalo) — `@verso/zalo`
- [Microsoft Teams](/channels/msteams) — `@verso/msteams`
- Google Antigravity OAuth (provider auth) — bundled as `google-antigravity-auth` (disabled by default)
- Gemini CLI OAuth (provider auth) — bundled as `google-gemini-cli-auth` (disabled by default)
- Qwen OAuth (provider auth) — bundled as `qwen-portal-auth` (disabled by default)
- Copilot Proxy (provider auth) — local VS Code Copilot Proxy bridge; distinct from built-in `github-copilot` device login (bundled, disabled by default)

Verso plugins are **TypeScript modules** loaded at runtime via jiti. **Config
validation does not execute plugin code**; it uses the plugin manifest and JSON
Schema instead. See [Plugin manifest](/plugins/manifest).

Plugins can register:

- Gateway RPC methods
- Gateway HTTP handlers
- Agent tools
- CLI commands
- Background services
- Optional config validation
- **Skills** (by listing `skills` directories in the plugin manifest)
- **Auto-reply commands** (execute without invoking the AI agent)

Plugins run **in‑process** with the Gateway, so treat them as trusted code.
Tool authoring guide: [Plugin agent tools](/plugins/agent-tools).

## Runtime helpers

Plugins can access selected core helpers via `api.runtime`. For telephony TTS:

```ts
const result = await api.runtime.tts.textToSpeechTelephony({
  text: "Hello from Verso",
  cfg: api.config,
});
```

Notes:

- Uses core `messages.tts` configuration (OpenAI or ElevenLabs).
- Returns PCM audio buffer + sample rate. Plugins must resample/encode for providers.
- Edge TTS is not supported for telephony.

## Discovery & precedence

Verso scans, in order:
