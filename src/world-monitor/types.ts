export type ThreatLevel = "critical" | "high" | "medium" | "low" | "info";

export type EventCategory =
  | "conflict"
  | "protest"
  | "disaster"
  | "diplomatic"
  | "economic"
  | "terrorism"
  | "cyber"
  | "health"
  | "environmental"
  | "military"
  | "crime"
  | "infrastructure"
  | "tech"
  | "general";

export interface ThreatClassification {
  level: ThreatLevel;
  category: EventCategory;
  confidence: number;
  source: "keyword" | "ml" | "llm";
}

export interface WorldSignal {
  id: string;
  timestamp: string; // ISO string
  source: string;
  title: string;
  description?: string;
  link: string;
  severity: ThreatLevel;
  category: EventCategory;
  threat: ThreatClassification;
  lat?: number;
  lon?: number;
  locationName?: string;
  metadata?: Record<string, unknown>;
}

export interface WorldBrief {
  id: string;
  timestamp: string;
  summary: string;
  signals: WorldSignal[];
  convergenceZones: string[];
}

export interface WorldMonitorConfig {
  feeds: {
    name: string;
    url: string;
    enabled: boolean;
  }[];
  refreshIntervalMinutes: number;
}

export interface GeoSignal extends WorldSignal {
  // Alias for compatibility with aggregator logic if needed
}

export interface CountrySignalCluster {
  country: string;
  countryName: string;
  signals: WorldSignal[];
  signalTypes: Set<string>;
  totalCount: number;
  highSeverityCount: number;
  convergenceScore: number;
}

export interface RegionalConvergence {
  region: string;
  countries: string[];
  signalTypes: string[];
  totalSignals: number;
  description: string;
}

export interface SignalSummary {
  timestamp: Date;
  totalSignals: number;
  byType: Record<string, number>;
  convergenceZones: RegionalConvergence[];
  topCountries: CountrySignalCluster[];
  aiContext: string;
}
