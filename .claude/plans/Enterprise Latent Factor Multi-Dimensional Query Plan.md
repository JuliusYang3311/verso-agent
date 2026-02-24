# Latent Factor Multi-Dimensional Query Plan

## Problem statement

Implement a production-ready latent-factor based multi-dimensional query projection and memory retrieval augmentation to support cross-source, multi-facet retrieval with observation signals for Evolver. The plan follows a 5-phase workflow with clear milestones, validation, and rollback points.

## Context (current state snapshot)

- Existing dynamic context and memory retrieval pipeline (MMR, hybrid vector+BM25, hierarchical search, dedup, progressive loading) is in place.
- A latent factor space prototype exists, including an initial factor-space catalog and placeholders for projection/learning hooks.
- The current codebase exposes RetrievedChunk meta fields and context params that are being extended for factor tracking and learning.
- Evolver integration hooks for factor lifecycles and learning signals are scaffolded but not production-ready.

## Goals

- Provide a production-grade latent factor library with persistent factor-space, versioned schemas, and rollback capability.
- Implement multi-factor query projection: project query into latent factor space, score factors, and select top K factors for retrieval, ensuring diversity across facets.
- Extend RetrievedChunk metadata to include factorsUsed and latentSpace details for observability and learning.
- Integrate Evolver hooks for factor lifecycle management and online/offline learning signals.
- End-to-end validation: unit tests, integration tests, static analysis, lint, and performance baselines.

## Proposed architecture (high level)

- Latent factor namespace: core API to manage model->factor mappings, and to describe factor vectors.
- Factor-space representations: JSON-backed catalog with initial set such as Internal, External, Trend, Cost, Policy, Technology, Risk, UserBehavior, Time, MarketMomentum, Regulatory, Compliance.
- Projection & scoring: compute cosine-like similarity between query vector and factor vectors; threshold-based coarse gating; MM-R style diversification across factors using a lightweight surrogate similarity (bigram-based) between factor fragments.
- RetrievedChunk enrichment: extend snippet metadata with factorsUsed and latentSpace provenance.
- Plan for learning signals: context_params.json extended with dimensionWeights and factorActivationThreshold; Evolver interfaces for hint-based learning.
- Observability: structured logs for factor usage, factor scoring distributions, and cross-factor coverage in final results.

## Milestones & tasks

1. Latent factor core library (2 weeks)

- Add src/memory/latent-factors.ts with LatentFactor, LatentFactorSpace, getFactorForModel, ensureFactorForModel.
- Persist to src/memory/factor-space.json as initial catalog.
- Basic tests for create/get/returning factor ids.

2. Projection + threshold gating (2 weeks)

- Extend memory search to project query into factor space and select factors above a threshold: projectQueryToFactors, selectFactorsAboveThreshold, mmrDiversifyFactors.
- Extend RetrievedChunk with factorsUsed and latentSpace fields.
- Add unit tests validating factor projection and metadata enrichment.

3. Learning configuration & Evolver hooks (1 week)

- Extend context_params.json with dimensionWeights and factorActivationThreshold.
- Implement placeholder Evolver hooks in src/evolver/dimension-hooks.ts for create/update/remove factor and usage metrics.
- Add tests and basic integration tests to ensure sign-off paths exist.

4. End-to-end validation (2 weeks)

- CI configuration, lint/typecheck, test suites, static analysis.
- Performance baselines and regression tests; ensure no degradation of existing search paths.
- Comprehensive documentation: changelog, API docs, usage examples.

5. Production-readiness & Rollback (1 week)

- Branching strategy: feature/enterprise-latent-factor.
- Add migration/downgrade plan, and rollback scripts.
- Final validation, stakeholder sign-off.

## Risks & mitigations

- Risk: Factor-space grows too large; mitigation: paging/eviction policies and versioned schemas.
- Risk: Threshold learning noise; mitigation: start with conservative default values and allow flag-based tuning.
- Risk: Production latency impact; mitigate with staged rollout and caching of factor projections.

## Acceptance criteria

- Latent factor core and projection paths exist and pass unit tests.
- RetrievedChunk contains factorsUsed metadata and latentSpace reference.
- Evolver hooks exist and can be wired for learning signals.
- All CI checks pass and performance baseline is met or improved.

## Next steps

- Confirm the plan, then I will implement on a production branch and provide diffs, test plans, and rollout guidance.
