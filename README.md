# Verso

A self-evolving personal AI assistant platform with multi-channel messaging support.

Verso enhances the personal AI agent experience by enabling **asynchronous tool execution**, **dynamic context retrieval**, and **self-evolving code optimization** — letting the AI assistant gradually adapt to each user's workflow over time.

## Key Features

### Asynchronous Tool Execution

Agent tool calls (shell commands, API requests, code generation) run asynchronously in the background. The agent can continue responding to user messages while tools execute, eliminating the blocking wait that traditional agent loops impose.

- Message I/O layer and turn execution layer are fully decoupled
- New user messages are steered into the active turn via `steer()` without interruption
- Tool completion triggers automatic agent resume

### Dynamic Context Retrieval

Instead of feeding the full conversation history into each LLM call (expensive and wasteful), Verso uses a **dynamic context builder** that intelligently selects what to include:

- **Dynamic recent message retention** — keeps recent messages based on a token budget, not a fixed count
- **Vector-based retrieval** — retrieves relevant older messages using similarity threshold (not fixed top-k), with time-decay weighting
- **Adaptive ratio** — automatically adjusts the balance between recent messages and retrieved context based on conversation pace and tool usage patterns
- All hyperparameters are tunable by the Evolver (see below)

### Self-Evolving Code (Evolver)

The Evolver is an integrated self-optimization engine powered by a Gene Expression Programming (GEP) protocol:

- **Sandbox-first** — all code modifications are tested in an isolated sandbox (`pnpm build` + `pnpm lint` + `pnpm test`) before deployment
- **Automatic rollback** — failed changes are reverted and recorded in `errors.jsonl`
- **Signal-driven** — extracts optimization signals from runtime logs (slow responses, high token usage, memory leaks, user corrections)
- **Hyperparameter tuning** — automatically adjusts context retrieval parameters based on usage feedback
- **User feedback loop** — implicit signals (repeated questions, interrupted tools) and explicit `/feedback` command drive optimization direction

### Multi-Channel Messaging

Connect your AI assistant across multiple platforms:

- **Telegram** — full bot support with group management
- **Discord** — server and DM integration
- **Slack** — workspace bot with thread support
- **WhatsApp** — personal and group messaging
- **Feishu (Lark)** — enterprise messaging integration

### Additional Capabilities

- **60+ Skills** — GitHub, Gmail, Calendar, Notion, Obsidian, crypto trading, video generation, web search, and more
- **Browser Control** — built-in browser automation tool
- **Cron Jobs** — scheduled task execution
- **Gateway & Web UI** — HTTP/WebSocket gateway with control panel
- **Memory System** — persistent memory with vector search (sqlite-vec)
- **Identity Files** — AGENT.md, SOUL.md, MEMORY.md for personality and context

## Architecture

```
User Message
    |
    v
+---------------------------------------------+
|         Message I/O Layer                   |
|  Receives messages, routes to active turn   |
|  or starts new turn (fire-and-forget)       |
+----------------------+-----------------------+
                       |
                       v
+---------------------------------------------+
|      Dynamic Context Builder                |
|  Token-budget recent messages               |
|  + Vector-retrieved relevant history        |
|  + Compaction summary (safety net)          |
+----------------------+-----------------------+
                       |
                       v
+---------------------------------------------+
|      Async Turn Execution Layer             |
|  LLM -> tool_use -> execute -> tool_result  |
|  -> LLM -> ... -> end_turn                  |
|  (self-driving loop, non-blocking)          |
+----------------------+-----------------------+
                       |
                       v
+---------------------------------------------+
|      Evolver (Background)                   |
|  GEP signals -> mutation -> sandbox test    |
|  -> deploy or rollback                      |
+---------------------------------------------+
```

## Tech Stack

- **Runtime**: Node.js >= 22.12.0
- **Language**: TypeScript (ESM)
- **Package Manager**: pnpm 10.23.0
- **Core Framework**: @mariozechner/pi-agent-core 0.52.9
- **Vector DB**: sqlite-vec (hybrid vector + BM25 search)
- **Testing**: Vitest (989 files, 6768 tests)

## Getting Started

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Start the gateway
pnpm gateway:start
```

## Project Structure

```
src/
  agents/          # Agent runtime, tools, dynamic context
  auto-reply/      # Message routing and dispatch
  evolver/         # Self-evolution engine (GEP protocol)
    gep/           # Gene Expression Programming modules
    ops/           # Lifecycle and build verification
    assets/        # Tunable parameters and logs
  gateway/         # HTTP/WebSocket gateway server
  memory/          # Vector memory with sqlite-vec
  config/          # Configuration and schema
  approval/        # Exec approval workflow
  heartbeat/       # Heartbeat and wake mechanisms
  env/             # Environment and shell utilities
  telegram/        # Telegram channel
  discord/         # Discord channel
  slack/           # Slack channel
  web/             # WhatsApp (Baileys) channel
  channels/        # Channel plugin system
extensions/        # 32 active extensions
skills/            # 65 skills (20 core)
test/              # Integration and compatibility tests
```

## Acknowledgments

This project is derived from [OpenClaw/MoltBot](https://github.com/moltbot/moltbot), originally created by **Peter Steinberger**. The OpenClaw framework provided the foundational multi-channel AI gateway architecture upon which Verso's async execution, dynamic context, and self-evolution capabilities were built. We sincerely thank Peter Steinberger and all OpenClaw contributors for their excellent work.

## License

MIT License. See [LICENSE](LICENSE) for details.
