// ── Types ────────────────────────────────────────────────────────────────────

export interface PersonalityState {
  rigor: number;
  risk_tolerance: number;
}

type MutationCategory = "repair" | "optimize" | "innovate";
type RiskLevel = "low" | "medium" | "high";

export interface Mutation {
  type: "Mutation";
  id: string;
  category: MutationCategory;
  trigger_signals: string[];
  target: string;
  expected_effect: string;
  risk_level: RiskLevel;
}

interface BuildMutationOptions {
  signals?: unknown[];
  selectedGene?: { id?: string } | null;
  driftEnabled?: boolean;
  personalityState?: PersonalityState | null;
  allowHighRisk?: boolean;
  target?: string;
  expected_effect?: string;
}

// ── Helpers (internal) ───────────────────────────────────────────────────────

export function clamp01(x: unknown): number {
  const n = Number(x);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(1, n));
}

function nowTsMs(): number {
  return Date.now();
}

function uniqStrings(list: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(list) ? list : []) {
    const s = String(x || "").trim();
    if (!s) {
      continue;
    }
    if (seen.has(s)) {
      continue;
    }
    seen.add(s);
    out.push(s);
  }
  return out;
}

function hasErrorishSignal(signals: unknown): boolean {
  const list: string[] = Array.isArray(signals) ? signals.map((s: unknown) => String(s || "")) : [];
  if (list.includes("log_error")) {
    return true;
  }
  if (list.some((s) => s.startsWith("errsig:") || s.startsWith("errsig_norm:"))) {
    return true;
  }
  return false;
}

// Opportunity signals that indicate a chance to innovate (not just fix).
export const OPPORTUNITY_SIGNALS: readonly string[] = [
  "user_feature_request",
  "user_improvement_suggestion",
  "perf_bottleneck",
  "capability_gap",
  "stable_success_plateau",
  "external_opportunity",
];

export function hasOpportunitySignal(signals: unknown): boolean {
  const list: string[] = Array.isArray(signals) ? signals.map((s: unknown) => String(s || "")) : [];
  for (let i = 0; i < OPPORTUNITY_SIGNALS.length; i++) {
    if (list.includes(OPPORTUNITY_SIGNALS[i])) {
      return true;
    }
  }
  return false;
}

function mutationCategoryFromContext({
  signals,
  driftEnabled,
}: {
  signals?: unknown[];
  driftEnabled?: boolean;
}): MutationCategory {
  if (hasErrorishSignal(signals)) {
    return "repair";
  }
  if (driftEnabled) {
    return "innovate";
  }
  // Auto-innovate: opportunity signals present and no errors
  if (hasOpportunitySignal(signals)) {
    return "innovate";
  }
  return "optimize";
}

function expectedEffectFromCategory(category: unknown): string {
  const c = String(category || "");
  if (c === "repair") {
    return "reduce runtime errors, increase stability, and lower failure rate";
  }
  if (c === "optimize") {
    return "improve success rate and reduce repeated operational cost";
  }
  if (c === "innovate") {
    return "explore new strategy combinations to escape local optimum";
  }
  return "improve robustness and success probability";
}

function targetFromGene(selectedGene?: { id?: string } | null): string {
  if (selectedGene && selectedGene.id) {
    return `gene:${String(selectedGene.id)}`;
  }
  return "behavior:protocol";
}

// ── Personality checks ───────────────────────────────────────────────────────

export function isHighRiskPersonality(p: PersonalityState | null | undefined): boolean {
  // Conservative definition: low rigor or high risk_tolerance is treated as high-risk personality.
  const rigor = p && Number.isFinite(Number(p.rigor)) ? Number(p.rigor) : null;
  const riskTol = p && Number.isFinite(Number(p.risk_tolerance)) ? Number(p.risk_tolerance) : null;
  if (rigor != null && rigor < 0.5) {
    return true;
  }
  if (riskTol != null && riskTol > 0.6) {
    return true;
  }
  return false;
}

export function isHighRiskMutationAllowed(
  personalityState: PersonalityState | null | undefined,
): boolean {
  const rigor =
    personalityState && Number.isFinite(Number(personalityState.rigor))
      ? Number(personalityState.rigor)
      : 0;
  const riskTol =
    personalityState && Number.isFinite(Number(personalityState.risk_tolerance))
      ? Number(personalityState.risk_tolerance)
      : 1;
  return rigor >= 0.6 && riskTol <= 0.5;
}

// ── Build / validate / normalize ─────────────────────────────────────────────

export function buildMutation({
  signals,
  selectedGene,
  driftEnabled,
  personalityState,
  allowHighRisk = false,
  target,
  expected_effect,
}: BuildMutationOptions = {}): Mutation {
  const ts = nowTsMs();
  const category = mutationCategoryFromContext({ signals, driftEnabled: !!driftEnabled });
  const triggerSignals = uniqStrings(signals);

  const base: Mutation = {
    type: "Mutation",
    id: `mut_${ts}`,
    category,
    trigger_signals: triggerSignals,
    target: String(target || targetFromGene(selectedGene)),
    expected_effect: String(expected_effect || expectedEffectFromCategory(category)),
    risk_level: "low",
  };

  // Default risk assignment: innovate is medium; others low.
  if (category === "innovate") {
    base.risk_level = "medium";
  }

  // Optional high-risk escalation (rare, and guarded by strict safety constraints).
  if (allowHighRisk && category === "innovate") {
    base.risk_level = "high";
  }

  // Safety constraints (hard):
  // - forbid innovate + high-risk personality (downgrade innovation to optimize)
  // - forbid high-risk mutation unless personality satisfies constraints
  const highRiskPersonality = isHighRiskPersonality(personalityState || null);
  if (base.category === "innovate" && highRiskPersonality) {
    base.category = "optimize";
    base.expected_effect =
      "safety downgrade: optimize under high-risk personality (avoid innovate+high-risk combo)";
    base.risk_level = "low";
    base.trigger_signals = uniqStrings([
      ...(base.trigger_signals || []),
      "safety:avoid_innovate_with_high_risk_personality",
    ]);
  }

  if (base.risk_level === "high" && !isHighRiskMutationAllowed(personalityState || null)) {
    // Downgrade rather than emit illegal high-risk mutation.
    base.risk_level = "medium";
    base.trigger_signals = uniqStrings([
      ...(base.trigger_signals || []),
      "safety:downgrade_high_risk",
    ]);
  }

  return base;
}

export function isValidMutation(obj: unknown): obj is Mutation {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  const o = obj as Record<string, unknown>;
  if (o.type !== "Mutation") {
    return false;
  }
  if (!o.id || typeof o.id !== "string") {
    return false;
  }
  if (!o.category || !["repair", "optimize", "innovate"].includes(String(o.category))) {
    return false;
  }
  if (!Array.isArray(o.trigger_signals)) {
    return false;
  }
  if (!o.target || typeof o.target !== "string") {
    return false;
  }
  if (!o.expected_effect || typeof o.expected_effect !== "string") {
    return false;
  }
  if (!o.risk_level || !["low", "medium", "high"].includes(String(o.risk_level))) {
    return false;
  }
  return true;
}

export function normalizeMutation(obj: unknown): Mutation {
  const m =
    obj && typeof obj === "object"
      ? (obj as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const out: Mutation = {
    type: "Mutation",
    id: typeof m.id === "string" ? m.id : `mut_${nowTsMs()}`,
    category: ["repair", "optimize", "innovate"].includes(String(m.category))
      ? (String(m.category) as MutationCategory)
      : "optimize",
    trigger_signals: uniqStrings(m.trigger_signals),
    target: typeof m.target === "string" ? m.target : "behavior:protocol",
    expected_effect:
      typeof m.expected_effect === "string"
        ? m.expected_effect
        : expectedEffectFromCategory(m.category),
    risk_level: ["low", "medium", "high"].includes(String(m.risk_level))
      ? (String(m.risk_level) as RiskLevel)
      : "low",
  };
  return out;
}
