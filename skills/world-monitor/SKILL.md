---
name: world-monitor
description: Access global intelligence, signals, and threat analysis
---

# WorldMonitor

The WorldMonitor skill gives you access to real-time global intelligence, signal analysis, and threat monitoring. It aggregates data from various sources (RSS feeds, news outlets) to identify emerging "convergence zones" of activity.

## Capability Overview

The WorldMonitor service runs within the Gateway and continuously:

1.  **Ingests** data from configured feeds (BBC, Reuters, Al Jazeera, etc.).
2.  **Classifies** signals based on keywords into categories (Conflict, Disaster, Tech, Political, Environment).
3.  **Assigns Severity** (Critical, High, Medium, Low) to each signal.
4.  **Generates Briefs** using automated analysis to summarize the global state and identify hotspots.

## Commands

### `pnpm verso wm brief`

Generates a high-level intelligence brief summarizing current world events and threats. Use this when the user asks for a general update.

**Usage:**

```bash
verso wm brief --limit 20 --hours 12
```

**Options:**

- `--limit <number>`: Number of recent signals to include in the context (default: 10).
- `--hours <number>`: Analysis window in hours (default: 24).

**Returns:** A JSON object containing:

- `summary`: Text summary of the current situation (e.g. "Regional convergence detected: Middle East...").
- `convergenceZones`: List of active hotspots (e.g. ["Middle East: Activity detected in Iran, Israel, Saudi Arabia"]).
- `signals`: The raw signals used for the brief.

**Example Output:**

```json
{
  "summary": "Regional convergence detected: Middle East",
  "convergenceZones": ["Middle East: Activity detected in Iran, Israel, Saudi Arabia"],
  "signals": [...]
}
```

### `pnpm verso wm signals`

Lists raw signals intercepted by the monitor. Use this for granular data or when monitoring specific high-frequency events.

**Usage:**

```bash
pnpm verso wm signals --limit 10 --hours 6
```

**Options:**

- `--limit <number>`: Number of signals to return (default: 20).
- `--hours <number>`: Filter window in hours (default: 24).

**Returns:** A JSON list of `WorldSignal` objects.

### `pnpm verso wm search`

Search historical signals for specific keywords. Use this when the user asks about a specific topic or event.

**Usage:**

```bash
pnpm verso wm search "earthquake" --limit 5
```

**Arguments:**

- `<query>`: The search query string (case-insensitive).

**Options:**

- `--limit <number>`: Maximum results to return (default: 20).

**Returns:** A JSON list of matching `WorldSignal` objects.

### `pnpm verso wm fetch`

Manually triggers a feed refresh from all configured RSS sources. Use this to force an update or debug data ingestion.

**Usage:**

```bash
pnpm verso wm fetch
```

**Returns:** Logs indicating start and completion of the fetch process.

## Data Structures

### WorldSignal

```typescript
interface WorldSignal {
  id: string; // Unique ID (e.g. "wm-1709232000000-xyz123")
  timestamp: string; // ISO 8601 date string
  source: string; // Source name (e.g. "Reuters World")
  title: string; // The headline
  link: string; // URL to the original article
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: "conflict" | "disaster" | "tech" | "diplomatic" | "military" | "general";
  threat: {
    level: "critical" | "high" | "medium" | "low" | "info";
    category: string;
    confidence: number;
    source: "keyword" | "ml" | "llm";
  };
}
```

### WorldBrief

```typescript
interface WorldBrief {
  id: string;
  timestamp: string;
  summary: string; // Automated intelligence summary
  signals: WorldSignal[]; // Most recent signals
  convergenceZones: string[]; // E.g., "Middle East: Activity detected in Iran, Israel..."
}
```

## Usage Guidelines for Agents

- **General Updates**: When asked "What's happening in the world?" or "Give me a briefing", use `pnpm verso wm brief`.
- **Specific Queries**: When asked "Any news on the hurricane?" or "What is the latest on the election?", use `pnpm verso wm search "hurricane"` or `pnpm verso wm search "election"`.
- **Monitoring**: If instructed to "watch for tech news", you can periodically polling `pnpm verso wm signals` or `pnpm verso wm search "tech"`.
- **Severity**: Pay close attention to `critical` and `high` severity signals. These should be highlighted to the user immediately.
