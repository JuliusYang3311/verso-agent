// Evolution Strategy Presets (v1.0)
// Controls the balance between repair, optimize, and innovate intents.
//
// Usage: set EVOLVE_STRATEGY env var to one of: balanced, innovate, harden, repair-only
// Default: balanced
//
// Each strategy defines:
//   repair/optimize/innovate  - target allocation ratios (inform the LLM prompt)
//   repairLoopThreshold       - repair ratio in last 8 cycles that triggers forced innovation
//   label                     - human-readable name injected into the GEP prompt

var STRATEGIES = {
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

function resolveStrategy() {
  var name = String(process.env.EVOLVE_STRATEGY || "balanced")
    .toLowerCase()
    .trim();
  // Backward compatibility: FORCE_INNOVATION=true maps to 'innovate'
  if (!process.env.EVOLVE_STRATEGY) {
    var fi = String(
      process.env.FORCE_INNOVATION || process.env.EVOLVE_FORCE_INNOVATION || "",
    ).toLowerCase();
    if (fi === "true") name = "innovate";
  }
  var strategy = STRATEGIES[name] || STRATEGIES["balanced"];
  strategy.name = name;
  return strategy;
}

function getStrategyNames() {
  return Object.keys(STRATEGIES);
}

module.exports = { resolveStrategy, getStrategyNames, STRATEGIES };
