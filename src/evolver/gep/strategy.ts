export type StrategyName = "balanced" | "innovate" | "harden" | "repair-only";

export type Strategy = {
  repair: number;
  optimize: number;
  innovate: number;
  repairLoopThreshold: number;
  label: string;
  description: string;
  name?: string;
};

export const STRATEGIES: Record<StrategyName, Strategy> = {
  balanced: {
    repair: 0.2,
    optimize: 0.3,
    innovate: 0.5,
    repairLoopThreshold: 0.5,
    label: "Balanced",
    description: "Normal operation. Steady growth with stability.",
  },
  innovate: {
    repair: 0.05,
    optimize: 0.15,
    innovate: 0.8,
    repairLoopThreshold: 0.3,
    label: "Innovation Focus",
    description: "System is stable. Maximize new features and capabilities.",
  },
  harden: {
    repair: 0.4,
    optimize: 0.4,
    innovate: 0.2,
    repairLoopThreshold: 0.7,
    label: "Hardening",
    description: "After a big change. Focus on stability and robustness.",
  },
  "repair-only": {
    repair: 0.8,
    optimize: 0.2,
    innovate: 0.0,
    repairLoopThreshold: 1.0,
    label: "Repair Only",
    description: "Emergency. Fix everything before doing anything else.",
  },
};

export function resolveStrategy(): Strategy & { name: string } {
  let name: string = String(process.env.EVOLVE_STRATEGY || "balanced")
    .toLowerCase()
    .trim();
  if (!process.env.EVOLVE_STRATEGY) {
    const fi = String(
      process.env.FORCE_INNOVATION || process.env.EVOLVE_FORCE_INNOVATION || "",
    ).toLowerCase();
    if (fi === "true") {
      name = "innovate";
    }
  }
  const strategy = STRATEGIES[name as StrategyName] || STRATEGIES["balanced"];
  return { ...strategy, name };
}

export function getStrategyNames(): string[] {
  return Object.keys(STRATEGIES);
}
