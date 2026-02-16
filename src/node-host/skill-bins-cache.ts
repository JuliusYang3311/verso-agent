export class SkillBinsCache {
  private bins = new Set<string>();
  private lastRefresh = 0;
  private readonly ttlMs = 90_000;
  private readonly fetch: () => Promise<string[]>;

  constructor(fetch: () => Promise<string[]>) {
    this.fetch = fetch;
  }

  async current(force = false): Promise<Set<string>> {
    if (force || Date.now() - this.lastRefresh > this.ttlMs) {
      await this.refresh();
    }
    return this.bins;
  }

  private async refresh() {
    try {
      const bins = await this.fetch();
      this.bins = new Set(bins);
      this.lastRefresh = Date.now();
    } catch {
      if (!this.lastRefresh) {
        this.bins = new Set();
      }
    }
  }
}
