---
summary: "Runbook for the Gateway service, lifecycle, and operations"
read_when:
  - Running or debugging the gateway process
title: "Gateway Runbook"
---

# Gateway service runbook

Last updated: 2025-12-09

## What it is

- The always-on process that owns the single Baileys/Telegram connection and the control/event plane.
- Replaces the legacy `gateway` command. CLI entry point: `verso gateway`.
- Runs until stopped; exits non-zero on fatal errors so the supervisor restarts it.

## How to run (local)

```bash
verso gateway --port 18789
# for full debug/trace logs in stdio:
verso gateway --port 18789 --verbose
# if the port is busy, terminate listeners then start:
verso gateway --force
# dev loop (auto-reload on TS changes):
pnpm gateway:watch
```

- # Config hot reload watches `~/.verso/verso.json` (or `VERSO_CONFIG_PATH`).
  openclaw gateway --port 18789

# for full debug/trace logs in stdio:

openclaw gateway --port 18789 --verbose

# if the port is busy, terminate listeners then start:

openclaw gateway --force

# dev loop (auto-reload on TS changes):

pnpm gateway:watch

````

- Config hot reload watches `~/.openclaw/openclaw.json` (or `OPENCLAW_CONFIG_PATH`).
>>>>>>> upstream/main
  - Default mode: `gateway.reload.mode="hybrid"` (hot-apply safe changes, restart on critical).
  - Hot reload uses in-process restart via **SIGUSR1** when needed.
  - Disable with `gateway.reload.mode="off"`.
- Binds WebSocket control plane to `127.0.0.1:<port>` (default 18789).
- The same port also serves HTTP (control UI, hooks, A2UI). Single-port multiplex.
  - OpenAI Chat Completions (HTTP): [`/v1/chat/completions`](/gateway/openai-http-api).
  - OpenResponses (HTTP): [`/v1/responses`](/gateway/openresponses-http-api).
  - Tools Invoke (HTTP): [`/tools/invoke`](/gateway/tools-invoke-http-api).
- Starts a Canvas file server by default on `canvasHost.port` (default `18793`), serving `http://<gateway-host>:18793/__verso__/canvas/` from `~/verso/canvas`. Disable with `canvasHost.enabled=false` or `VERSO_SKIP_CANVAS_HOST=1`.
- Logs to stdout; use launchd/systemd to keep it alive and rotate logs.
- Pass `--verbose` to mirror debug logging (handshakes, req/res, events) from the log file into stdio when troubleshooting.
- `--force` uses `lsof` to find listeners on the chosen port, sends SIGTERM, logs what it killed, then starts the gateway (fails fast if `lsof` is missing).
- If you run under a supervisor (launchd/systemd/mac app child-process mode), a stop/restart typically sends **SIGTERM**; older builds may surface this as `pnpm` `ELIFECYCLE` exit code **143** (SIGTERM), which is a normal shutdown, not a crash.
- **SIGUSR1** triggers an in-process restart when authorized (gateway tool/config apply/update, or enable `commands.restart` for manual restarts).
- Gateway auth is required by default: set `gateway.auth.token` (or `VERSO_GATEWAY_TOKEN`) or `gateway.auth.password`. Clients must send `connect.params.auth.token/password` unless using Tailscale Serve identity.
- The wizard now generates a token by default, even on loopback.
- Port precedence: `--port` > `VERSO_GATEWAY_PORT` > `gateway.port` > default `18789`.

## Remote access

- Tailscale/VPN preferred; otherwise SSH tunnel:

  ```bash
  ssh -N -L 18789:127.0.0.1:18789 user@host
````

- Clients then connect to `ws://127.0.0.1:18789` through the tunnel.
- If a token is configured, clients must include it in `connect.params.auth.token` even over the tunnel.

## Multiple gateways (same host)

Usually unnecessary: one Gateway can serve multiple messaging channels and agents. Use multiple Gateways only for redundancy or strict isolation (ex: rescue bot).

Supported if you isolate state + config and use unique ports. Full guide: [Multiple gateways](/gateway/multiple-gateways).

Service names are profile-aware:

- macOS: `bot.molt.<profile>` (legacy `com.verso.*` may still exist)
- Linux: `verso-gateway-<profile>.service`
- Windows: `Verso Gateway (<profile>)`

Install metadata is embedded in the service config:

- `VERSO_SERVICE_MARKER=verso`
- `VERSO_SERVICE_KIND=gateway`
- # `VERSO_SERVICE_VERSION=<version>`

- macOS: `bot.molt.<profile>` (legacy `com.openclaw.*` may still exist)
- Linux: `openclaw-gateway-<profile>.service`
- Windows: `Verso Gateway (<profile>)`

Install metadata is embedded in the service config:

- `OPENCLAW_SERVICE_MARKER=openclaw`
- `OPENCLAW_SERVICE_KIND=gateway`
- `OPENCLAW_SERVICE_VERSION=<version>`
  > > > > > > > upstream/main

Rescue-Bot Pattern: keep a second Gateway isolated with its own profile, state dir, workspace, and base port spacing. Full guide: [Rescue-bot guide](/gateway/multiple-gateways#rescue-bot-guide).

### Dev profile (`--dev`)

Fast path: run a fully-isolated dev instance (config/state/workspace) without touching your primary setup.

```bash
<<<<<<< HEAD
verso --dev setup
verso --dev gateway --allow-unconfigured
# then target the dev instance:
verso --dev status
verso --dev health
```

Defaults (can be overridden via env/flags/config):

- `VERSO_STATE_DIR=~/.verso-dev`
- `VERSO_CONFIG_PATH=~/.verso-dev/verso.json`
- `VERSO_GATEWAY_PORT=19001` (Gateway WS + HTTP)
- browser control service port = `19003` (derived: `gateway.port+2`, loopback only)
- `canvasHost.port=19005` (derived: `gateway.port+4`)
- `agents.defaults.workspace` default becomes `~/verso-dev` when you run `setup`/`onboard` under `--dev`.

Derived ports (rules of thumb):

- Base port = `gateway.port` (or `VERSO_GATEWAY_PORT` / `--port`)
- browser control service port = base + 2 (loopback only)
- # `canvasHost.port = base + 4` (or `VERSO_CANVAS_HOST_PORT` / config override)
  openclaw --dev setup
  openclaw --dev gateway --allow-unconfigured

# then target the dev instance:

openclaw --dev status
openclaw --dev health

````

Defaults (can be overridden via env/flags/config):

- `OPENCLAW_STATE_DIR=~/.openclaw-dev`
- `OPENCLAW_CONFIG_PATH=~/.openclaw-dev/openclaw.json`
- `OPENCLAW_GATEWAY_PORT=19001` (Gateway WS + HTTP)
- browser control service port = `19003` (derived: `gateway.port+2`, loopback only)
- `canvasHost.port=19005` (derived: `gateway.port+4`)
- `agents.defaults.workspace` default becomes `~/.openclaw/workspace-dev` when you run `setup`/`onboard` under `--dev`.

Derived ports (rules of thumb):

- Base port = `gateway.port` (or `OPENCLAW_GATEWAY_PORT` / `--port`)
- browser control service port = base + 2 (loopback only)
- `canvasHost.port = base + 4` (or `OPENCLAW_CANVAS_HOST_PORT` / config override)
>>>>>>> upstream/main
- Browser profile CDP ports auto-allocate from `browser.controlPort + 9 .. + 108` (persisted per profile).

Checklist per instance:

- unique `gateway.port`
- unique `VERSO_CONFIG_PATH`
- unique `VERSO_STATE_DIR`
- unique `agents.defaults.workspace`
- separate WhatsApp numbers (if using WA)

Service install per profile:

```bash
verso --profile main gateway install
verso --profile rescue gateway install
````

Example:

```bash
VERSO_CONFIG_PATH=~/.verso/a.json VERSO_STATE_DIR=~/.verso-a verso gateway --port 19001
VERSO_CONFIG_PATH=~/.verso/b.json VERSO_STATE_DIR=~/.verso-b verso gateway --port 19002
```

## Protocol (operator view)

- Full docs: [Gateway protocol](/gateway/protocol) and [Bridge protocol (legacy)](/gateway/bridge-protocol).
- Mandatory first frame from client: `req {type:"req", id, method:"connect", params:{minProtocol,maxProtocol,client:{id,displayName?,version,platform,deviceFamily?,modelIdentifier?,mode,instanceId?}, caps, auth?, locale?, userAgent? } }`.
- Gateway replies `res {type:"res", id, ok:true, payload:hello-ok }` (or `ok:false` with an error, then closes).
- After handshake:
  - Requests: `{type:"req", id, method, params}` → `{type:"res", id, ok, payload|error}`
  - Events: `{type:"event", event, payload, seq?, stateVersion?}`
- Structured presence entries: `{host, ip, version, platform?, deviceFamily?, modelIdentifier?, mode, lastInputSeconds?, ts, reason?, tags?[], instanceId? }` (for WS clients, `instanceId` comes from `connect.client.instanceId`).
- `agent` responses are two-stage: first `res` ack `{runId,status:"accepted"}`, then a final `res` `{runId,status:"ok"|"error",summary}` after the run finishes; streamed output arrives as `event:"agent"`.

## Methods (initial set)

<<<<<<< HEAD

- # `health` — full health snapshot (same shape as `verso health --json`).

- `health` — full health snapshot (same shape as `openclaw health --json`).
  > > > > > > > upstream/main
- `status` — short summary.
- `system-presence` — current presence list.
- `system-event` — post a presence/system note (structured).
- `send` — send a message via the active channel(s).
- `agent` — run an agent turn (streams events back on same connection).
- `node.list` — list paired + currently-connected nodes (includes `caps`, `deviceFamily`, `modelIdentifier`, `paired`, `connected`, and advertised `commands`).
- `node.describe` — describe a node (capabilities + supported `node.invoke` commands; works for paired nodes and for currently-connected unpaired nodes).
- `node.invoke` — invoke a command on a node (e.g. `canvas.*`, `camera.*`).
- `node.pair.*` — pairing lifecycle (`request`, `list`, `approve`, `reject`, `verify`).

See also: [Presence](/concepts/presence) for how presence is produced/deduped and why a stable `client.instanceId` matters.

## Events

- `agent` — streamed tool/output events from the agent run (seq-tagged).
- `presence` — presence updates (deltas with stateVersion) pushed to all connected clients.
- `tick` — periodic keepalive/no-op to confirm liveness.
- `shutdown` — Gateway is exiting; payload includes `reason` and optional `restartExpectedMs`. Clients should reconnect.

## WebChat integration

- WebChat is a native SwiftUI UI that talks directly to the Gateway WebSocket for history, sends, abort, and events.
- Remote use goes through the same SSH/Tailscale tunnel; if a gateway token is configured, the client includes it during `connect`.
- macOS app connects via a single WS (shared connection); it hydrates presence from the initial snapshot and listens for `presence` events to update the UI.

## Typing and validation

- Server validates every inbound frame with AJV against JSON Schema emitted from the protocol definitions.
- Clients (TS/Swift) consume generated types (TS directly; Swift via the repo’s generator).
- Protocol definitions are the source of truth; regenerate schema/models with:
  - `pnpm protocol:gen`
  - `pnpm protocol:gen:swift`

## Connection snapshot

- `hello-ok` includes a `snapshot` with `presence`, `health`, `stateVersion`, and `uptimeMs` plus `policy {maxPayload,maxBufferedBytes,tickIntervalMs}` so clients can render immediately without extra requests.
- `health`/`system-presence` remain available for manual refresh, but are not required at connect time.

## Error codes (res.error shape)

- Errors use `{ code, message, details?, retryable?, retryAfterMs? }`.
- Standard codes:
  - `NOT_LINKED` — WhatsApp not authenticated.
  - `AGENT_TIMEOUT` — agent did not respond within the configured deadline.
  - `INVALID_REQUEST` — schema/param validation failed.
  - `UNAVAILABLE` — Gateway is shutting down or a dependency is unavailable.

## Keepalive behavior

- `tick` events (or WS ping/pong) are emitted periodically so clients know the Gateway is alive even when no traffic occurs.
- Send/agent acknowledgements remain separate responses; do not overload ticks for sends.

## Replay / gaps

- Events are not replayed. Clients detect seq gaps and should refresh (`health` + `system-presence`) before continuing. WebChat and macOS clients now auto-refresh on gap.

## Supervision (macOS example)

- Use launchd to keep the service alive:
  - Program: path to `verso`
  - Arguments: `gateway`
  - KeepAlive: true
  - StandardOut/Err: file paths or `syslog`
- On failure, launchd restarts; fatal misconfig should keep exiting so the operator notices.
- LaunchAgents are per-user and require a logged-in session; for headless setups use a custom LaunchDaemon (not shipped).
  - `verso gateway install` writes `~/Library/LaunchAgents/bot.molt.gateway.plist`
    (or `bot.molt.<profile>.plist`; legacy `com.verso.*` is cleaned up).
  - `verso doctor` audits the LaunchAgent config and can update it to current defaults.

## Gateway service management (CLI)

Use the Gateway CLI for install/start/stop/restart/status:

```bash
verso gateway status
verso gateway install
verso gateway stop
verso gateway restart
verso logs --follow
```

Notes:

- `gateway status` probes the Gateway RPC by default using the service’s resolved port/config (override with `--url`).
- `gateway status --deep` adds system-level scans (LaunchDaemons/system units).
- `gateway status --no-probe` skips the RPC probe (useful when networking is down).
- `gateway status --json` is stable for scripts.
- `gateway status` reports **supervisor runtime** (launchd/systemd running) separately from **RPC reachability** (WS connect + status RPC).
- `gateway status` prints config path + probe target to avoid “localhost vs LAN bind” confusion and profile mismatches.
- `gateway status` includes the last gateway error line when the service looks running but the port is closed.
- `logs` tails the Gateway file log via RPC (no manual `tail`/`grep` needed).
  <<<<<<< HEAD
- If other gateway-like services are detected, the CLI warns unless they are Verso profile services.
  We still recommend **one gateway per machine** for most setups; use isolated profiles/ports for redundancy or a rescue bot. See [Multiple gateways](/gateway/multiple-gateways).
  - Cleanup: `verso gateway uninstall` (current service) and `verso doctor` (legacy migrations).
- `gateway install` is a no-op when already installed; use `verso gateway install --force` to reinstall (profile/env/path changes).

Bundled mac app:

- Verso.app can bundle a Node-based gateway relay and install a per-user LaunchAgent labeled
  `bot.molt.gateway` (or `bot.molt.<profile>`; legacy `com.verso.*` labels still unload cleanly).
- To stop it cleanly, use `verso gateway stop` (or `launchctl bootout gui/$UID/bot.molt.gateway`).
- To restart, use `verso gateway restart` (or `launchctl kickstart -k gui/$UID/bot.molt.gateway`).
  - `launchctl` only works if the LaunchAgent is installed; otherwise use `verso gateway install` first.
  - Replace the label with `bot.molt.<profile>` when running a named profile.

## Supervision (systemd user unit)

# Verso installs a **systemd user service** by default on Linux/WSL2. We

- If other gateway-like services are detected, the CLI warns unless they are Verso profile services.
  We still recommend **one gateway per machine** for most setups; use isolated profiles/ports for redundancy or a rescue bot. See [Multiple gateways](/gateway/multiple-gateways).
  - Cleanup: `openclaw gateway uninstall` (current service) and `openclaw doctor` (legacy migrations).
- `gateway install` is a no-op when already installed; use `openclaw gateway install --force` to reinstall (profile/env/path changes).

Bundled mac app:

- Verso.app can bundle a Node-based gateway relay and install a per-user LaunchAgent labeled
  `bot.molt.gateway` (or `bot.molt.<profile>`; legacy `com.openclaw.*` labels still unload cleanly).
- To stop it cleanly, use `openclaw gateway stop` (or `launchctl bootout gui/$UID/bot.molt.gateway`).
- To restart, use `openclaw gateway restart` (or `launchctl kickstart -k gui/$UID/bot.molt.gateway`).
  - `launchctl` only works if the LaunchAgent is installed; otherwise use `openclaw gateway install` first.
  - Replace the label with `bot.molt.<profile>` when running a named profile.

## Supervision (systemd user unit)

Verso installs a **systemd user service** by default on Linux/WSL2. We

> > > > > > > upstream/main
> > > > > > > recommend user services for single-user machines (simpler env, per-user config).
> > > > > > > Use a **system service** for multi-user or always-on servers (no lingering
> > > > > > > required, shared supervision).

<<<<<<< HEAD
`verso gateway install` writes the user unit. `verso doctor` audits the
unit and can update it to match the current recommended defaults.

Create `~/.config/systemd/user/verso-gateway[-<profile>].service`:

```
[Unit]
Description=Verso Gateway (profile: <profile>, v<version>)
- Update clients to speak the WS protocol with mandatory connect and structured presence.
```
