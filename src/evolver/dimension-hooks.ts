/**
 * dimension-hooks.ts
 *
 * Evolver integration hooks for latent factor lifecycle and learning signals.
 *
 * These hooks are called at query time to emit observable signals that the
 * Evolver can consume for online/offline learning:
 *   - Which factors were activated for a given query
 *   - Which factors produced no useful results (misses)
 *   - Suggested threshold adjustments based on retrieval feedback
 *
 * Current implementation: structured console logging (no-op for learning).
 * Future: wire to Evolver feedback-collector or A2A signal bus.
 */

export type FactorHitEvent = {
  factorId: string;
  querySnippet: string;
  retrievalScore: number;
  providerModel: string;
  timestamp: number;
};

export type FactorMissEvent = {
  factorId: string;
  querySnippet: string;
  providerModel: string;
  timestamp: number;
};

export type ThresholdFeedbackEvent = {
  factorId: string;
  currentThreshold: number;
  suggestedThreshold: number;
  providerModel: string;
  timestamp: number;
};

export type DimensionHooks = {
  onFactorHit(event: FactorHitEvent): void;
  onFactorMiss(event: FactorMissEvent): void;
  onThresholdFeedback(event: ThresholdFeedbackEvent): void;
};

// ---------- Default implementation: structured logging ----------

export const loggingDimensionHooks: DimensionHooks = {
  onFactorHit(event) {
    console.debug(
      `[latent-factor] hit factor=${event.factorId} score=${event.retrievalScore.toFixed(3)} model=${event.providerModel}`,
    );
  },
  onFactorMiss(event) {
    console.debug(`[latent-factor] miss factor=${event.factorId} model=${event.providerModel}`);
  },
  onThresholdFeedback(event) {
    console.debug(
      `[latent-factor] threshold-feedback factor=${event.factorId} current=${event.currentThreshold} suggested=${event.suggestedThreshold} model=${event.providerModel}`,
    );
  },
};

// ---------- No-op implementation (for testing / disabled paths) ----------

export const noopDimensionHooks: DimensionHooks = {
  onFactorHit: () => {},
  onFactorMiss: () => {},
  onThresholdFeedback: () => {},
};

// ---------- Hook registry (replaceable at runtime by Evolver) ----------

let _activeHooks: DimensionHooks = loggingDimensionHooks;

export function getDimensionHooks(): DimensionHooks {
  return _activeHooks;
}

/**
 * Replace the active hooks implementation.
 * Called by Evolver when wiring up its feedback-collector.
 */
export function registerDimensionHooks(hooks: DimensionHooks): void {
  _activeHooks = hooks;
}

// ---------- Convenience emitters ----------

export function emitFactorHit(
  factorId: string,
  querySnippet: string,
  retrievalScore: number,
  providerModel: string,
): void {
  _activeHooks.onFactorHit({
    factorId,
    querySnippet,
    retrievalScore,
    providerModel,
    timestamp: Date.now(),
  });
}

export function emitFactorMiss(
  factorId: string,
  querySnippet: string,
  providerModel: string,
): void {
  _activeHooks.onFactorMiss({
    factorId,
    querySnippet,
    providerModel,
    timestamp: Date.now(),
  });
}

export function emitThresholdFeedback(
  factorId: string,
  currentThreshold: number,
  suggestedThreshold: number,
  providerModel: string,
): void {
  _activeHooks.onThresholdFeedback({
    factorId,
    currentThreshold,
    suggestedThreshold,
    providerModel,
    timestamp: Date.now(),
  });
}
