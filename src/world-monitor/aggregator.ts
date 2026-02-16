import type {
  WorldSignal,
  SignalSummary,
  CountrySignalCluster,
  RegionalConvergence,
} from "./types.js";

// Basic country codes map
const TIER1_COUNTRIES: Record<string, string> = {
  IR: "Iran",
  IL: "Israel",
  SA: "Saudi Arabia",
  AE: "UAE",
  IQ: "Iraq",
  SY: "Syria",
  YE: "Yemen",
  JO: "Jordan",
  LB: "Lebanon",
  CN: "China",
  TW: "Taiwan",
  JP: "Japan",
  KR: "South Korea",
  KP: "North Korea",
  IN: "India",
  PK: "Pakistan",
  BD: "Bangladesh",
  AF: "Afghanistan",
  UA: "Ukraine",
  RU: "Russia",
  BY: "Belarus",
  PL: "Poland",
  EG: "Egypt",
  LY: "Libya",
  SD: "Sudan",
  US: "USA",
  GB: "UK",
  DE: "Germany",
  FR: "France",
};

const REGION_DEFINITIONS: Record<string, { countries: string[]; name: string }> = {
  middle_east: {
    name: "Middle East",
    countries: ["IR", "IL", "SA", "AE", "IQ", "SY", "YE", "JO", "LB", "KW", "QA", "OM", "BH"],
  },
  east_asia: {
    name: "East Asia",
    countries: ["CN", "TW", "JP", "KR", "KP", "HK", "MN"],
  },
  south_asia: {
    name: "South Asia",
    countries: ["IN", "PK", "BD", "AF", "NP", "LK", "MM"],
  },
  europe_east: {
    name: "Eastern Europe",
    countries: ["UA", "RU", "BY", "PL", "RO", "MD", "HU", "CZ", "SK", "BG"],
  },
};

const COUNTRY_TO_CODE: Record<string, string> = {
  Iran: "IR",
  Israel: "IL",
  "Saudi Arabia": "SA",
  "United Arab Emirates": "AE",
  Iraq: "IQ",
  Syria: "SY",
  Yemen: "YE",
  Jordan: "JO",
  Lebanon: "LB",
  China: "CN",
  Taiwan: "TW",
  Japan: "JP",
  "South Korea": "KR",
  "North Korea": "KP",
  India: "IN",
  Pakistan: "PK",
  Bangladesh: "BD",
  Afghanistan: "AF",
  Ukraine: "UA",
  Russia: "RU",
  Belarus: "BY",
  Poland: "PL",
  Egypt: "EG",
  Libya: "LY",
  Sudan: "SD",
  "United States": "US",
  "United Kingdom": "GB",
  Germany: "DE",
  France: "FR",
};

function _normalizeCountryCode(country: string): string {
  if (country.length === 2) {
    return country.toUpperCase();
  }
  return COUNTRY_TO_CODE[country] || country.slice(0, 2).toUpperCase();
}

function getCountryName(code: string): string {
  return TIER1_COUNTRIES[code] || code;
}

export class SignalAggregator {
  private signals: WorldSignal[] = [];
  private readonly WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

  addSignal(signal: WorldSignal): void {
    // Deduplicate by ID
    if (this.signals.some((s) => s.id === signal.id)) {
      return;
    }
    this.signals.push(signal);
    this.pruneOld();
  }

  clear(): void {
    this.signals = [];
  }

  private pruneOld(): void {
    const cutoff = Date.now() - this.WINDOW_MS;
    this.signals = this.signals.filter((s) => new Date(s.timestamp).getTime() > cutoff);
  }

  // Basic regex-based geo-inference if not provided
  private inferCountry(text: string): string {
    for (const [name, code] of Object.entries(COUNTRY_TO_CODE)) {
      if (text.includes(name)) {
        return code;
      }
    }
    return "XX";
  }

  getCountryClusters(windowMs?: number): CountrySignalCluster[] {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    const byCountry = new Map<string, WorldSignal[]>();

    for (const s of this.signals) {
      if (cutoff > 0 && new Date(s.timestamp).getTime() < cutoff) {
        continue;
      }

      // If we don't have explicit country, try to infer from title
      let countryCode = "XX";
      if (s.metadata && typeof s.metadata.country === "string") {
        countryCode = s.metadata.country;
      } else {
        countryCode = this.inferCountry(s.title);
      }

      if (countryCode === "XX") {
        continue;
      }

      const existing = byCountry.get(countryCode) || [];
      existing.push(s);
      byCountry.set(countryCode, existing);
    }

    const clusters: CountrySignalCluster[] = [];

    for (const [country, signals] of byCountry) {
      const signalTypes = new Set(signals.map((s) => s.category));
      const highCount = signals.filter(
        (s) => s.threat.level === "high" || s.threat.level === "critical",
      ).length;

      // Scoring logic from original
      const typeBonus = signalTypes.size * 20;
      const countBonus = Math.min(30, signals.length * 5);
      const severityBonus = highCount * 10;
      const convergenceScore = Math.min(100, typeBonus + countBonus + severityBonus);

      clusters.push({
        country,
        countryName: getCountryName(country),
        signals,
        signalTypes,
        totalCount: signals.length,
        highSeverityCount: highCount,
        convergenceScore,
      });
    }

    return clusters.toSorted((a, b) => b.convergenceScore - a.convergenceScore);
  }

  getRegionalConvergence(windowMs?: number): RegionalConvergence[] {
    const clusters = this.getCountryClusters(windowMs);
    const convergences: RegionalConvergence[] = [];

    for (const [_regionId, def] of Object.entries(REGION_DEFINITIONS)) {
      const regionClusters = clusters.filter((c) => def.countries.includes(c.country));
      if (regionClusters.length < 2) {
        continue;
      }

      const allTypes = new Set<string>();
      let totalSignals = 0;

      for (const cluster of regionClusters) {
        cluster.signalTypes.forEach((t) => allTypes.add(t));
        totalSignals += cluster.totalCount;
      }

      if (allTypes.size >= 2) {
        const countries = regionClusters.map((c) => c.countryName).join(", ");
        convergences.push({
          region: def.name,
          countries: regionClusters.map((c) => c.country),
          signalTypes: [...allTypes],
          totalSignals,
          description: `${def.name}: Activity detected in ${countries}`,
        });
      }
    }

    return convergences.toSorted((a, b) => b.totalSignals - a.totalSignals);
  }

  generateAIContext(windowMs?: number): string {
    const clusters = this.getCountryClusters(windowMs).slice(0, 5);
    const convergences = this.getRegionalConvergence(windowMs).slice(0, 3);

    if (clusters.length === 0 && convergences.length === 0) {
      return "No significant geopolitical signals detected in the specified window.";
    }

    const lines: string[] = ["[GEOGRAPHIC SIGNALS]"];

    if (convergences.length > 0) {
      lines.push("Regional convergence detected:");
      for (const c of convergences) {
        lines.push(`- ${c.description}`);
      }
    }

    if (clusters.length > 0) {
      lines.push("Top countries by signal activity:");
      for (const c of clusters) {
        const types = [...c.signalTypes].join(", ");
        lines.push(
          `- ${c.countryName}: ${c.totalCount} signals (${types}), risk score: ${c.convergenceScore}`,
        );
      }
    }

    return lines.join("\n");
  }

  getSummary(windowMs?: number): SignalSummary {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    const filteredSignals =
      cutoff > 0
        ? this.signals.filter((s) => new Date(s.timestamp).getTime() >= cutoff)
        : this.signals;

    const byType: Record<string, number> = {};
    for (const s of filteredSignals) {
      byType[s.category] = (byType[s.category] || 0) + 1;
    }

    return {
      timestamp: new Date(),
      totalSignals: filteredSignals.length,
      byType,
      convergenceZones: this.getRegionalConvergence(windowMs),
      topCountries: this.getCountryClusters(windowMs).slice(0, 10),
      aiContext: this.generateAIContext(windowMs),
    };
  }

  getSignals(): WorldSignal[] {
    return this.signals;
  }
}

export const signalAggregator = new SignalAggregator();
