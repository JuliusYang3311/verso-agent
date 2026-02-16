function stableHash(input: string | null | undefined): string {
  const s = String(input || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function clip(text: string | null | undefined, maxChars: number): string {
  const s = String(text || "");
  if (!maxChars || s.length <= maxChars) {
    return s;
  }
  return s.slice(0, Math.max(0, maxChars - 20)) + " ...[TRUNCATED]";
}

function toLines(text: string | null | undefined): string[] {
  return String(text || "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean);
}

function extractToolCalls(transcript: string): string[] {
  const lines = toLines(transcript);
  const calls: string[] = [];
  for (const line of lines) {
    const m = line.match(/\[TOOL:\s*([^\]]+)\]/i);
    if (m && m[1]) {
      calls.push(m[1].trim());
    }
  }
  return calls;
}

function countFreq(items: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of items) {
    map.set(it, (map.get(it) || 0) + 1);
  }
  return map;
}

export type FiveQuestionsShape = {
  title: string;
  input: string;
  output: string;
  invariants: string;
  params: string;
  failure_points: string;
  evidence: string;
};

export type CapabilityCandidate = {
  type: "CapabilityCandidate";
  id: string;
  title: string;
  source: string;
  created_at: string;
  signals: string[];
  shape: FiveQuestionsShape;
};

function buildFiveQuestionsShape(params: {
  title: string;
  signals: string[];
  evidence: string;
}): FiveQuestionsShape {
  const input = "Recent session transcript + memory snippets + user instructions";
  const output = "A safe, auditable evolution patch guided by GEP assets";
  const invariants = "Protocol order, small reversible patches, validation, append-only events";
  const paramStr =
    `Signals: ${Array.isArray(params.signals) ? params.signals.join(", ") : ""}`.trim();
  const failurePoints =
    "Missing signals, over-broad changes, skipped validation, missing knowledge solidification";
  return {
    title: String(params.title || "").slice(0, 120),
    input,
    output,
    invariants,
    params: paramStr || "Signals: (none)",
    failure_points: failurePoints,
    evidence: clip(params.evidence, 240),
  };
}

export function extractCapabilityCandidates(params: {
  recentSessionTranscript: string;
  signals: string[];
}): CapabilityCandidate[] {
  const candidates: CapabilityCandidate[] = [];
  const toolCalls = extractToolCalls(params.recentSessionTranscript);
  const freq = countFreq(toolCalls);

  for (const [tool, count] of freq.entries()) {
    if (count < 2) {
      continue;
    }
    const title = `Repeated tool usage: ${tool}`;
    const evidence = `Observed ${count} occurrences of tool call marker for ${tool}.`;
    const shape = buildFiveQuestionsShape({ title, signals: params.signals, evidence });
    candidates.push({
      type: "CapabilityCandidate",
      id: `cand_${stableHash(title)}`,
      title,
      source: "transcript",
      created_at: new Date().toISOString(),
      signals: Array.isArray(params.signals) ? params.signals : [],
      shape,
    });
  }

  const signalList = Array.isArray(params.signals) ? params.signals : [];
  const signalCandidates = [
    { signal: "log_error", title: "Repair recurring runtime errors" },
    { signal: "protocol_drift", title: "Prevent protocol drift and enforce auditable outputs" },
    {
      signal: "windows_shell_incompatible",
      title: "Avoid platform-specific shell assumptions (Windows compatibility)",
    },
    { signal: "session_logs_missing", title: "Harden session log detection and fallback behavior" },
    { signal: "user_feature_request", title: "Implement user-requested feature" },
    { signal: "user_improvement_suggestion", title: "Apply user improvement suggestion" },
    { signal: "perf_bottleneck", title: "Resolve performance bottleneck" },
    { signal: "capability_gap", title: "Fill capability gap" },
    { signal: "stable_success_plateau", title: "Explore new strategies during stability plateau" },
    { signal: "external_opportunity", title: "Evaluate external A2A asset for local adoption" },
  ];

  for (const sc of signalCandidates) {
    if (!signalList.includes(sc.signal)) {
      continue;
    }
    const evidence = `Signal present: ${sc.signal}`;
    const shape = buildFiveQuestionsShape({ title: sc.title, signals: params.signals, evidence });
    candidates.push({
      type: "CapabilityCandidate",
      id: `cand_${stableHash(sc.signal)}`,
      title: sc.title,
      source: "signals",
      created_at: new Date().toISOString(),
      signals: signalList,
      shape,
    });
  }

  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (!c || !c.id) {
      return false;
    }
    if (seen.has(c.id)) {
      return false;
    }
    seen.add(c.id);
    return true;
  });
}

export function renderCandidatesPreview(
  candidates: CapabilityCandidate[] | null | undefined,
  maxChars = 1400,
): string {
  const list = Array.isArray(candidates) ? candidates : [];
  const lines: string[] = [];
  for (const c of list) {
    const s = c && c.shape ? c.shape : ({} as Partial<FiveQuestionsShape>);
    lines.push(`- ${c.id}: ${c.title}`);
    lines.push(`  - input: ${s.input || ""}`);
    lines.push(`  - output: ${s.output || ""}`);
    lines.push(`  - invariants: ${s.invariants || ""}`);
    lines.push(`  - params: ${s.params || ""}`);
    lines.push(`  - failure_points: ${s.failure_points || ""}`);
    if (s.evidence) {
      lines.push(`  - evidence: ${s.evidence}`);
    }
  }
  return clip(lines.join("\n"), maxChars);
}
