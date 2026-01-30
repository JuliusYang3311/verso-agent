---
summary: "CLI reference for `verso voicecall` (voice-call plugin command surface)"
read_when:
  - You use the voice-call plugin and want the CLI entry points
  - You want quick examples for `voicecall call|continue|status|tail|expose`
---

# `verso voicecall`

`voicecall` is a plugin-provided command. It only appears if the voice-call plugin is installed and enabled.

Primary doc:
- Voice-call plugin: [Voice Call](/plugins/voice-call)

## Common commands

```bash
verso voicecall status --call-id <id>
verso voicecall call --to "+15555550123" --message "Hello" --mode notify
verso voicecall continue --call-id <id> --message "Any questions?"
verso voicecall end --call-id <id>
```

## Exposing webhooks (Tailscale)

```bash
verso voicecall expose --mode serve
verso voicecall expose --mode funnel
verso voicecall unexpose
```

Security note: only expose the webhook endpoint to networks you trust. Prefer Tailscale Serve over Funnel when possible.

