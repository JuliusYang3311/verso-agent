import type { WorldBrief, WorldSignal } from "./types.js";
import { signalAggregator } from "./aggregator.js";
import { fetchRssFeed } from "./fetchers/rss.js";
import { wmStorage } from "./storage.js";
import { generateId } from "./utils.js";

// Default feeds configuration
const DEFAULT_FEEDS = [
  { name: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml", enabled: true },
  {
    name: "Reuters World",
    url: "https://news.google.com/rss/search?q=source:Reuters&hl=en-US&gl=US&ceid=US:en",
    enabled: true,
  },
  { name: "The Guardian", url: "https://www.theguardian.com/world/rss", enabled: true },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", enabled: true },
  { name: "Defense One", url: "https://www.defenseone.com/rss/all/", enabled: true },
  { name: "Hacker News", url: "https://hnrss.org/newest?points=100", enabled: true },
];

export class WorldMonitorService {
  private pollingInterval: NodeJS.Timeout | null = null;
  private isRefreshing = false;

  async start() {
    console.log("[WorldMonitor] Starting service...");
    await wmStorage.init();

    // Load persisted state
    const savedSignals = await wmStorage.loadSignals();
    for (const s of savedSignals) {
      signalAggregator.addSignal(s);
    }
    console.log(`[WorldMonitor] Loaded ${savedSignals.length} signals from storage.`);

    // Initial refresh
    this.refreshFeeds().catch((err) =>
      console.error("[WorldMonitor] Initial refresh failed:", err),
    );

    // Start polling (every 5 minutes)
    this.pollingInterval = setInterval(
      () => {
        this.refreshFeeds().catch((err) =>
          console.error("[WorldMonitor] Background refresh failed:", err),
        );
      },
      5 * 60 * 1000,
    );
  }

  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  async refreshFeeds() {
    if (this.isRefreshing) {
      return;
    }
    this.isRefreshing = true;

    try {
      console.log("[WorldMonitor] Refreshing feeds...");
      const promises = DEFAULT_FEEDS.filter((f) => f.enabled).map((f) =>
        fetchRssFeed(f.name, f.url),
      );

      const results = await Promise.allSettled(promises);
      let newCount = 0;

      for (const result of results) {
        if (result.status === "fulfilled") {
          for (const signal of result.value) {
            signalAggregator.addSignal(signal);
            newCount++;
          }
        }
      }

      console.log(`[WorldMonitor] Feed refresh complete. Ingested ${newCount} signals.`);

      // Persist signals
      await wmStorage.saveSignals(signalAggregator.getSignals());
    } finally {
      this.isRefreshing = false;
    }
  }

  getBrief(limit = 10, hours = 24): WorldBrief {
    // Generate a realtime brief from the aggregator
    const windowMs = hours * 60 * 60 * 1000;
    const summary = signalAggregator.getSummary(windowMs);

    // Filter signals by time window too
    const cutoff = Date.now() - windowMs;
    const latestSignals = signalAggregator
      .getSignals()
      .filter((s) => new Date(s.timestamp).getTime() >= cutoff)
      .toSorted((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    return {
      id: generateId(),
      timestamp: new Date().toISOString(),
      summary: summary.aiContext || "No significant activity detected via automated analysis.",
      convergenceZones: summary.convergenceZones.map((z) => z.description),
      signals: latestSignals,
    };
  }

  async getSignals(limit = 20, hours = 24): Promise<WorldSignal[]> {
    const windowMs = hours * 60 * 60 * 1000;
    const cutoff = Date.now() - windowMs;

    return signalAggregator
      .getSignals()
      .filter((s) => new Date(s.timestamp).getTime() >= cutoff)
      .toSorted((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  async search(query: string, limit = 20): Promise<WorldSignal[]> {
    const lowerQuery = query.toLowerCase();
    return signalAggregator
      .getSignals()
      .filter(
        (s) =>
          s.title.toLowerCase().includes(lowerQuery) ||
          s.threat.category.includes(lowerQuery) ||
          s.source.toLowerCase().includes(lowerQuery),
      )
      .slice(0, limit);
  }
}

export const worldMonitor = new WorldMonitorService();
