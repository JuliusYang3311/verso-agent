import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorldSignal, WorldBrief } from "./types.js";

const DATA_DIR = path.join(os.homedir(), ".verso", "data", "world-monitor");
export const SIGNALS_FILE = path.join(DATA_DIR, "signals.json");
const BRIEFS_FILE = path.join(DATA_DIR, "briefs.json");

export class WorldMonitorStorage {
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize WorldMonitor storage:", error);
    }
  }

  async saveSignals(signals: WorldSignal[]): Promise<void> {
    await this.init();
    try {
      await fs.writeFile(SIGNALS_FILE, JSON.stringify(signals, null, 2), "utf-8");
    } catch (error) {
      console.error("Failed to save signals:", error);
    }
  }

  async loadSignals(): Promise<WorldSignal[]> {
    await this.init();
    try {
      const data = await fs.readFile(SIGNALS_FILE, "utf-8");
      return JSON.parse(data) as WorldSignal[];
    } catch (error) {
      if ((error as any).code === "ENOENT") {
        return [];
      }
      console.error("Failed to load signals:", error);
      return [];
    }
  }

  async saveBrief(brief: WorldBrief): Promise<void> {
    await this.init();
    try {
      const briefs = await this.loadBriefs();
      briefs.push(brief);
      // Keep last 50 briefs
      if (briefs.length > 50) {
        briefs.shift();
      }
      await fs.writeFile(BRIEFS_FILE, JSON.stringify(briefs, null, 2), "utf-8");
    } catch (error) {
      console.error("Failed to save brief:", error);
    }
  }

  async loadBriefs(): Promise<WorldBrief[]> {
    await this.init();
    try {
      const data = await fs.readFile(BRIEFS_FILE, "utf-8");
      return JSON.parse(data) as WorldBrief[];
    } catch (error) {
      if ((error as any).code === "ENOENT") {
        return [];
      }
      console.error("Failed to load briefs:", error);
      return [];
    }
  }

  async getLatestBrief(): Promise<WorldBrief | null> {
    const briefs = await this.loadBriefs();
    return briefs.length > 0 ? briefs[briefs.length - 1] : null;
  }
}

export const wmStorage = new WorldMonitorStorage();
