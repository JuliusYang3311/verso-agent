import type { ThreatClassification, ThreatLevel, EventCategory } from "./types.js";
import {
  CRITICAL_KEYWORDS,
  HIGH_KEYWORDS,
  MEDIUM_KEYWORDS,
  LOW_KEYWORDS,
  TECH_HIGH_KEYWORDS,
  TECH_MEDIUM_KEYWORDS,
  TECH_LOW_KEYWORDS,
  EXCLUSIONS,
  SHORT_KEYWORDS,
  THREAT_PRIORITY,
} from "./constants.js";

const keywordRegexCache = new Map<string, RegExp>();

function getKeywordRegex(kw: string): RegExp {
  let re = keywordRegexCache.get(kw);
  if (!re) {
    // For short keywords, match whole word only
    if (SHORT_KEYWORDS.has(kw)) {
      re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    } else {
      re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    }
    keywordRegexCache.set(kw, re);
  }
  return re;
}

function matchKeywords(
  titleLower: string,
  keywords: Record<string, EventCategory>,
): { keyword: string; category: EventCategory } | null {
  for (const [kw, cat] of Object.entries(keywords)) {
    if (getKeywordRegex(kw).test(titleLower)) {
      return { keyword: kw, category: cat };
    }
  }
  return null;
}

export function classifyByKeyword(
  title: string,
  variant: "full" | "tech" = "full",
): ThreatClassification {
  const lower = title.toLowerCase();

  // Exclusions
  if (EXCLUSIONS.some((ex) => lower.includes(ex))) {
    return { level: "info", category: "general", confidence: 0.3, source: "keyword" };
  }

  const isTech = variant === "tech";

  // Critical
  let match = matchKeywords(lower, CRITICAL_KEYWORDS);
  if (match) {
    return { level: "critical", category: match.category, confidence: 0.9, source: "keyword" };
  }

  // High
  match = matchKeywords(lower, HIGH_KEYWORDS);
  if (match) {
    return { level: "high", category: match.category, confidence: 0.8, source: "keyword" };
  }

  if (isTech) {
    match = matchKeywords(lower, TECH_HIGH_KEYWORDS);
    if (match) {
      return { level: "high", category: match.category, confidence: 0.75, source: "keyword" };
    }
  }

  // Medium
  match = matchKeywords(lower, MEDIUM_KEYWORDS);
  if (match) {
    return { level: "medium", category: match.category, confidence: 0.7, source: "keyword" };
  }

  if (isTech) {
    match = matchKeywords(lower, TECH_MEDIUM_KEYWORDS);
    if (match) {
      return { level: "medium", category: match.category, confidence: 0.65, source: "keyword" };
    }
  }

  // Low
  match = matchKeywords(lower, LOW_KEYWORDS);
  if (match) {
    return { level: "low", category: match.category, confidence: 0.6, source: "keyword" };
  }

  if (isTech) {
    match = matchKeywords(lower, TECH_LOW_KEYWORDS);
    if (match) {
      return { level: "low", category: match.category, confidence: 0.55, source: "keyword" };
    }
  }

  return { level: "info", category: "general", confidence: 0.3, source: "keyword" };
}

// Stub for AI classification - meant to be hooked up to Verso's LLM
export async function classifyWithAI(
  title: string,
  variant: string,
): Promise<ThreatClassification | null> {
  // TODO: Integrate with defaultRuntime.llm or an agent for deeper analysis
  // For now, return null to fallback to keyword
  return null;
}

export function aggregateThreats(
  items: Array<{ threat?: ThreatClassification; tier?: number }>,
): ThreatClassification {
  const withThreat = items.filter((i) => i.threat);
  if (withThreat.length === 0) {
    return { level: "info", category: "general", confidence: 0.3, source: "keyword" };
  }

  // Max level
  let maxLevel: ThreatLevel = "info";
  let maxPriority = 0;
  for (const item of withThreat) {
    const p = THREAT_PRIORITY[item.threat!.level] || 1;
    if (p > maxPriority) {
      maxPriority = p;
      maxLevel = item.threat!.level;
    }
  }

  // Mode category
  const catCounts = new Map<EventCategory, number>();
  for (const item of withThreat) {
    const cat = item.threat!.category;
    catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
  }
  let topCat: EventCategory = "general";
  let topCount = 0;
  for (const [cat, count] of catCounts) {
    if (count > topCount) {
      topCount = count;
      topCat = cat;
    }
  }

  return {
    level: maxLevel,
    category: topCat,
    confidence: 0.8, // Simplification
    source: "keyword", // Simplification
  };
}
