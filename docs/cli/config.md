---
summary: "CLI reference for `verso config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
---

# `verso config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `verso configure`).

## Examples

```bash
verso config get browser.executablePath
verso config set browser.executablePath "/usr/bin/google-chrome"
verso config set agents.defaults.heartbeat.every "2h"
verso config set agents.list[0].tools.exec.node "node-id-or-name"
verso config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
verso config get agents.defaults.workspace
verso config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
verso config get agents.list
verso config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--json` to require JSON5 parsing.

```bash
verso config set agents.defaults.heartbeat.every "0m"
verso config set gateway.port 19001 --json
verso config set channels.whatsapp.groups '["*"]' --json
```

Restart the gateway after edits.
