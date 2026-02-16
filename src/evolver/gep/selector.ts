export type Gene = {
  type: "Gene";
  id: string;
  signals_match?: string[];
  [key: string]: unknown;
};

export type Capsule = {
  type?: string;
  id?: string;
  trigger?: string[];
  [key: string]: unknown;
};

export type SelectorDecision = {
  selected: string | null;
  reason: string[];
  alternatives: string[];
};

export type MemoryAdvice = {
  bannedGeneIds?: Set<string>;
  preferredGeneId?: string | null;
  explanation?: string[];
  [key: string]: unknown;
};

export function matchPatternToSignals(
  pattern: string | null | undefined,
  signals: string[],
): boolean {
  if (!pattern || !signals || signals.length === 0) {
    return false;
  }
  const p = String(pattern);
  const sig = signals.map((s) => String(s));

  const regexLike = p.length >= 2 && p.startsWith("/") && p.lastIndexOf("/") > 0;
  if (regexLike) {
    const lastSlash = p.lastIndexOf("/");
    const body = p.slice(1, lastSlash);
    const flags = p.slice(lastSlash + 1);
    try {
      const re = new RegExp(body, flags || "i");
      return sig.some((s) => re.test(s));
    } catch {
      // fallback to substring
    }
  }

  const needle = p.toLowerCase();
  return sig.some((s) => s.toLowerCase().includes(needle));
}

export function scoreGene(gene: Gene | null | undefined, signals: string[]): number {
  if (!gene || gene.type !== "Gene") {
    return 0;
  }
  const patterns = Array.isArray(gene.signals_match) ? gene.signals_match : [];
  if (patterns.length === 0) {
    return 0;
  }
  let score = 0;
  for (const pat of patterns) {
    if (matchPatternToSignals(pat, signals)) {
      score += 1;
    }
  }
  return score;
}

export function selectGene(
  genes: Gene[],
  signals: string[],
  opts?: {
    bannedGeneIds?: Set<string>;
    driftEnabled?: boolean;
    preferredGeneId?: string | null;
  },
): { selected: Gene | null; alternatives: Gene[] } {
  const bannedGeneIds = opts && opts.bannedGeneIds ? opts.bannedGeneIds : new Set<string>();
  const driftEnabled = !!(opts && opts.driftEnabled);
  const preferredGeneId =
    opts && typeof opts.preferredGeneId === "string" ? opts.preferredGeneId : null;

  const scored = genes
    .map((g) => ({ gene: g, score: scoreGene(g, signals) }))
    .filter((x) => x.score > 0)
    .toSorted((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { selected: null, alternatives: [] };
  }

  if (preferredGeneId) {
    const preferred = scored.find((x) => x.gene && x.gene.id === preferredGeneId);
    if (preferred && (driftEnabled || !bannedGeneIds.has(preferredGeneId))) {
      const rest = scored.filter((x) => x.gene && x.gene.id !== preferredGeneId);
      const filteredRest = driftEnabled
        ? rest
        : rest.filter((x) => x.gene && !bannedGeneIds.has(x.gene.id));
      return {
        selected: preferred.gene,
        alternatives: filteredRest.slice(0, 4).map((x) => x.gene),
      };
    }
  }

  const filtered = driftEnabled
    ? scored
    : scored.filter((x) => x.gene && !bannedGeneIds.has(x.gene.id));
  if (filtered.length === 0) {
    return { selected: null, alternatives: scored.slice(0, 4).map((x) => x.gene) };
  }

  return {
    selected: filtered[0].gene,
    alternatives: filtered.slice(1, 4).map((x) => x.gene),
  };
}

export function selectCapsule(
  capsules: Capsule[] | null | undefined,
  signals: string[],
): Capsule | null {
  const scored = (capsules || [])
    .map((c) => {
      const triggers = Array.isArray(c.trigger) ? c.trigger : [];
      const score = triggers.reduce(
        (acc, t) => (matchPatternToSignals(t, signals) ? acc + 1 : acc),
        0,
      );
      return { capsule: c, score };
    })
    .filter((x) => x.score > 0)
    .toSorted((a, b) => b.score - a.score);
  return scored.length ? scored[0].capsule : null;
}

export function selectGeneAndCapsule(params: {
  genes: Gene[];
  capsules: Capsule[];
  signals: string[];
  memoryAdvice?: MemoryAdvice | null;
  driftEnabled?: boolean;
}): {
  selectedGene: Gene | null;
  capsuleCandidates: Capsule[];
  selector: SelectorDecision;
} {
  const bannedGeneIds =
    params.memoryAdvice && params.memoryAdvice.bannedGeneIds instanceof Set
      ? params.memoryAdvice.bannedGeneIds
      : new Set<string>();
  const preferredGeneId =
    params.memoryAdvice && params.memoryAdvice.preferredGeneId
      ? params.memoryAdvice.preferredGeneId
      : null;

  const envPreferredGeneIdRaw = String(process.env.EVOLVE_PREFERRED_GENE_ID || "").trim();
  const envPreferredGeneId = envPreferredGeneIdRaw || null;
  const matchedGeneIds = new Set(
    (params.genes || [])
      .filter((g) => g && g.type === "Gene" && scoreGene(g, params.signals) > 0)
      .map((g) => g.id),
  );
  const envPreferredAllowed =
    !!envPreferredGeneId &&
    matchedGeneIds.has(envPreferredGeneId) &&
    (!!params.driftEnabled || !bannedGeneIds.has(envPreferredGeneId));
  const effectivePreferredGeneId = envPreferredAllowed ? envPreferredGeneId : preferredGeneId;

  const { selected, alternatives } = selectGene(params.genes, params.signals, {
    bannedGeneIds,
    preferredGeneId: effectivePreferredGeneId,
    driftEnabled: !!params.driftEnabled,
  });
  const capsule = selectCapsule(params.capsules, params.signals);
  const selector = buildSelectorDecision({
    gene: selected,
    capsule,
    signals: params.signals,
    alternatives,
    memoryAdvice: params.memoryAdvice,
    driftEnabled: params.driftEnabled,
  });

  const debugSelector = String(process.env.EVOLVE_SELECTOR_DEBUG || "").toLowerCase() === "true";
  if (debugSelector) {
    const matchedPreferred =
      !!preferredGeneId &&
      matchedGeneIds.has(preferredGeneId) &&
      !bannedGeneIds.has(preferredGeneId);
    console.error(
      `[SelectorDebug] preferred(memory)=${preferredGeneId || "(none)"} matched=${matchedPreferred} ` +
        `override(env)=${envPreferredGeneId || "(none)"} applied=${envPreferredAllowed} ` +
        `effective=${effectivePreferredGeneId || "(none)"} selected=${selected && selected.id ? selected.id : "(none)"}`,
    );
    if (envPreferredGeneId && !envPreferredAllowed) {
      console.error(
        `[SelectorDebug] ignored EVOLVE_PREFERRED_GENE_ID=${envPreferredGeneId} ` +
          `(must be matched candidate${params.driftEnabled ? "" : " and not banned"})`,
      );
    }
  }

  return {
    selectedGene: selected,
    capsuleCandidates: capsule ? [capsule] : [],
    selector,
  };
}

export function buildSelectorDecision(params: {
  gene: Gene | null;
  capsule: Capsule | null;
  signals: string[];
  alternatives: Gene[];
  memoryAdvice?: MemoryAdvice | null;
  driftEnabled?: boolean;
}): SelectorDecision {
  const reason: string[] = [];
  if (params.gene) {
    reason.push("signals match gene.signals_match");
  }
  if (params.capsule) {
    reason.push("capsule trigger matches signals");
  }
  if (!params.gene) {
    reason.push("no matching gene found; new gene may be required");
  }
  if (params.signals && params.signals.length) {
    reason.push(`signals: ${params.signals.join(", ")}`);
  }

  if (
    params.memoryAdvice &&
    Array.isArray(params.memoryAdvice.explanation) &&
    params.memoryAdvice.explanation.length
  ) {
    reason.push(`memory_graph: ${params.memoryAdvice.explanation.join(" | ")}`);
  }
  if (params.driftEnabled) {
    reason.push("random_drift_override: true");
  }

  return {
    selected: params.gene ? params.gene.id : null,
    reason,
    alternatives: Array.isArray(params.alternatives) ? params.alternatives.map((g) => g.id) : [],
  };
}
