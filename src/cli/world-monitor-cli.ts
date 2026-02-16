import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { WorldMonitorService } from "../world-monitor/service.js";

// Direct service usage for CLI (bypassing gateway for now to ensure robustness)
const service = new WorldMonitorService();

import fs from "node:fs/promises";

async function ensureData(forceRefresh = false) {
  const { wmStorage, SIGNALS_FILE } = await import("../world-monitor/storage.js");
  const { signalAggregator } = await import("../world-monitor/aggregator.js");

  await wmStorage.init();

  // Check if data is stale (older than 5 minutes)
  let shouldRefresh = forceRefresh;
  if (!shouldRefresh) {
    try {
      const stats = await fs.stat(SIGNALS_FILE);
      const ageMs = Date.now() - stats.mtimeMs;
      // If data is older than 5 minutes, refresh it automatically
      if (ageMs > 5 * 60 * 1000) {
        shouldRefresh = true;
      }
    } catch {
      shouldRefresh = true; // File doesn't exist
    }
  }

  if (shouldRefresh) {
    if (forceRefresh) {
      defaultRuntime.log("Force refreshing feeds...");
    } else {
      defaultRuntime.log("Data is stale, auto-refreshing feeds...");
    }

    try {
      await service.refreshFeeds();
    } catch (err) {
      defaultRuntime.log(`Warning: Failed to refresh feeds: ${String(err)}`);
    }
  }

  const savedSignals = await wmStorage.loadSignals();
  for (const s of savedSignals) {
    signalAggregator.addSignal(s);
  }
}

export function registerWorldMonitorCli(program: Command) {
  const wm = program.command("wm").description("WorldMonitor intelligence tool");

  wm.command("brief")
    .description("Generate an intelligence brief")
    .option("--limit <number>", "Number of signals to analyze", "20")
    .option("--hours <number>", "Analysis window in hours", "24")
    .action(async (opts) => {
      await ensureData();
      const limit = parseInt(opts.limit, 10);
      const hours = parseInt(opts.hours, 10);
      const brief = service.getBrief(limit, hours);
      defaultRuntime.log(JSON.stringify(brief, null, 2));
    });

  wm.command("signals")
    .description("List raw signals")
    .option("--limit <number>", "Number of signals to return", "50")
    .option("--hours <number>", "Filter window in hours", "24")
    .action(async (opts) => {
      await ensureData();
      const limit = parseInt(opts.limit, 10);
      const hours = parseInt(opts.hours, 10);
      const signals = await service.getSignals(limit, hours);
      defaultRuntime.log(JSON.stringify(signals, null, 2));
    });

  wm.command("search")
    .description("Search signals")
    .argument("<query>", "Search query")
    .option("--limit <number>", "Max results", "20")
    .action(async (query, opts) => {
      await ensureData();
      const limit = parseInt(opts.limit, 10);
      const results = await service.search(query, limit);
      defaultRuntime.log(JSON.stringify(results, null, 2));
    });

  wm.command("fetch")
    .description("Manually trigger a feed refresh")
    .action(async () => {
      await ensureData(true);
      defaultRuntime.log("Feed refresh complete.");
    });
}
