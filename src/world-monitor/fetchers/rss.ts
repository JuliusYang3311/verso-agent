import { DOMParser } from "linkedom";
import type { WorldSignal } from "../types.js";
import { classifyByKeyword } from "../classifier.js";
import { generateId, isFeedOnCooldown, recordFeedFailure, recordFeedSuccess } from "../utils.js";

interface _FeedItem {
  title: string;
  link: string;
  pubDate: Date;
  content?: string;
}

async function fetchFeedContent(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Verso/WorldMonitor Bot 1.0",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchRssFeed(feedName: string, url: string): Promise<WorldSignal[]> {
  if (isFeedOnCooldown(feedName)) {
    return [];
  }

  try {
    const text = await fetchFeedContent(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/xml");

    // Check for parse errors (LinkeDOM might not emit parsererror tags same as browser, but we try)
    if (doc.querySelectorAll("parsererror").length > 0) {
      throw new Error("XML Parse Error");
    }

    let items = Array.from(doc.querySelectorAll("item"));
    let isAtom = false;
    if (items.length === 0) {
      items = Array.from(doc.querySelectorAll("entry"));
      isAtom = true;
    }

    const parsedSignals: WorldSignal[] = items.slice(0, 10).map((item) => {
      const title = item.querySelector("title")?.textContent || "Untitled";

      let link = "";
      if (isAtom) {
        link = item.querySelector("link[href]")?.getAttribute("href") || "";
      } else {
        link = item.querySelector("link")?.textContent || "";
      }

      const pubDateStr = isAtom
        ? item.querySelector("published")?.textContent ||
          item.querySelector("updated")?.textContent ||
          ""
        : item.querySelector("pubDate")?.textContent || "";

      const pubDate = pubDateStr ? new Date(pubDateStr) : new Date();

      const threat = classifyByKeyword(title);

      return {
        id: generateId(),
        timestamp: pubDate.toISOString(),
        source: feedName,
        title,
        link,
        severity: threat.level,
        category: threat.category,
        threat,
      };
    });

    recordFeedSuccess(feedName);
    return parsedSignals;
  } catch (error) {
    recordFeedFailure(feedName);
    console.warn(
      `[WM] Failed to fetch ${feedName}:`,
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}
