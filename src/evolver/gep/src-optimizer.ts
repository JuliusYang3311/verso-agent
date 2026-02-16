/**
 * src/ core code optimizer
 * Extends Evolver to support optimizing core code under the src/ directory
 */

import fs from "node:fs";
import path from "node:path";
import { upsertGene } from "./assetStore.js";
import { SCHEMA_VERSION, computeAssetId } from "./contentHash.js";
import { getRepoRoot, getGepAssetsDir } from "./paths.js";

// ---------- Types ----------

/** Constraints governing how src/ optimizations are applied */
export interface SrcOptimizationConstraints {
  /** Maximum number of files that may be changed */
  max_files: number;
  /** Maximum number of lines that may be changed */
  max_lines: number;
  /** Paths that must never be modified */
  forbidden_paths: string[];
  /** Glob patterns for high-risk files requiring extra validation */
  high_risk_patterns: string[];
  /** Test commands that must all pass */
  required_tests: string[];
}

/** Parameters for creating a src optimization gene */
export interface SrcOptimizationGeneParams {
  /** Gene category: repair, optimize, or innovate */
  category?: string;
  /** Optimization target (e.g. "performance", "memory", "error-handling") */
  target: string;
  /** Signal strings to match against */
  signals?: string[];
  /** Human-readable description of the optimization */
  description?: string;
}

/** A fully-formed src optimization gene object */
export interface SrcOptimizationGene {
  type: string;
  schema_version: string;
  id: string;
  category: string;
  signals_match: string[];
  preconditions: string[];
  strategy: string[];
  constraints: SrcOptimizationConstraints & {
    scope: string;
    target_category: string;
  };
  validation: string[];
  meta: {
    created_at: string;
    scope: string;
    risk_level: string;
    requires_sandbox: boolean;
    requires_full_test_suite: boolean;
  };
  asset_id?: string | null;
  [key: string]: unknown;
}

/** Blast radius metrics for a set of changes */
export interface BlastRadius {
  files: number;
  lines: number;
  [key: string]: unknown;
}

/** Result of validating src/ changes against constraints */
export interface SrcValidationResult {
  ok: boolean;
  violations: string[];
  high_risk_files: string[];
  requires_extra_validation: boolean;
}

/** Parameters for testing changes in a sandbox */
export interface TestInSandboxParams {
  repoRoot?: string;
  commands?: string[];
}

/** Parameters for recording an error event */
export interface RecordErrorParams {
  errorType: string;
  errorMessage: string;
  changedFiles?: string[];
  blastRadius?: Record<string, unknown>;
  testResults?: Record<string, unknown>;
}

/** An error event record written to the error log */
export interface ErrorEvent {
  type: string;
  schema_version: string;
  timestamp: string;
  error_type: string;
  error_message: string;
  context: {
    changed_files: string[];
    blast_radius: Record<string, unknown>;
    test_results: Record<string, unknown>;
  };
}

// ---------- Constants ----------

/**
 * Special constraints for src/ code (stricter than skills)
 */
export const SRC_OPTIMIZATION_CONSTRAINTS: SrcOptimizationConstraints = {
  // Maximum number of changed files (stricter than skills)
  max_files: 3,

  // Maximum number of changed lines
  max_lines: 100,

  // Critical paths that must not be modified
  forbidden_paths: [
    ".git",
    "node_modules",
    "dist",
    "build",
    ".github/workflows", // CI/CD config requires manual review
  ],

  // High-risk file patterns (require extra validation)
  high_risk_patterns: [
    "**/gateway/**", // Gateway core
    "**/config/sessions.ts", // Session management
    "**/memory/manager.ts", // Memory management
    "**/agents/pi-*.ts", // Pi Agent core
  ],

  // Required test commands
  required_tests: [
    "pnpm build", // Build verification
    "pnpm lint", // Code quality
    "pnpm test", // Unit tests
  ],
};

/**
 * Predefined src/ optimization gene definitions
 */
export const PREDEFINED_SRC_GENES: SrcOptimizationGeneParams[] = [
  {
    category: "repair",
    target: "memory_leak",
    signals: ["high_memory_usage", "memory_leak", "heap_out_of_memory"],
    description: "Fix memory leak issues",
  },
  {
    category: "optimize",
    target: "performance",
    signals: ["slow_response", "high_latency", "timeout"],
    description: "Performance optimization (reduce latency, improve throughput)",
  },
  {
    category: "repair",
    target: "error_handling",
    signals: ["uncaught_exception", "unhandled_rejection", "crash"],
    description: "Enhance error handling",
  },
  {
    category: "optimize",
    target: "token_usage",
    signals: ["high_token_usage", "context_overflow"],
    description: "Optimize token usage (reduce input tokens)",
  },
  {
    category: "repair",
    target: "type_safety",
    signals: ["type_error", "typescript_error", "lint_error"],
    description: "Improve type safety",
  },
  {
    category: "optimize",
    target: "code_quality",
    signals: ["code_smell", "complexity_high", "duplicate_code"],
    description: "Code quality optimization (refactor, deduplicate)",
  },
];

// ---------- Functions ----------

/**
 * Check whether a file path matches any high-risk pattern
 */
export function isHighRiskFile(filePath: string): boolean {
  const patterns = SRC_OPTIMIZATION_CONSTRAINTS.high_risk_patterns;

  for (const pattern of patterns) {
    // Simple glob matching (** means any depth)
    const regex = new RegExp(
      pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\./g, "\\."),
    );

    if (regex.test(filePath)) {
      return true;
    }
  }

  return false;
}

/**
 * Create an optimization Gene for src/ code
 */
export function createSrcOptimizationGene(params: SrcOptimizationGeneParams): SrcOptimizationGene {
  const {
    category = "optimize", // repair | optimize | innovate
    target, // optimization target (e.g. "performance", "memory", "error-handling")
    signals = [],
    description = "",
  } = params;

  const geneId = `gene_src_${category}_${target.replace(/[^a-z0-9]/gi, "_")}`;

  const gene: SrcOptimizationGene = {
    type: "Gene",
    schema_version: SCHEMA_VERSION,
    id: geneId,
    category,

    // Signal matching (error signals extracted from logs)
    signals_match: signals.length > 0 ? signals : [`src_${target}`],

    // Preconditions
    preconditions: [
      "sandbox_available", // Sandbox environment must be available
      "tests_passing", // Tests must be passing
      "no_pending_changes", // Working tree must be clean
    ],

    // Optimization strategy
    strategy: [
      `[CONTEXT] Optimize src/ core code - ${description}`,
      "[SAFETY] Test all changes in a Docker sandbox",
      "[CONSTRAINTS] Strictly follow max_files=3, max_lines=100",
      "[VALIDATION] Run the full test suite (build + lint + test)",
      "[ROLLBACK] Roll back immediately on any failure, log detailed errors",
      "[LEARNING] Record failure patterns to the memory graph",
    ],

    // Strict constraints
    constraints: {
      ...SRC_OPTIMIZATION_CONSTRAINTS,
      scope: "src", // Restrict to src/ directory
      target_category: target,
    },

    // Validation commands (all must pass)
    validation: [
      "node -e \"console.log('Pre-check: OK')\"",
      ...SRC_OPTIMIZATION_CONSTRAINTS.required_tests,
    ],

    // Metadata
    meta: {
      created_at: new Date().toISOString(),
      scope: "core_src",
      risk_level: "high", // src/ code has a high risk level
      requires_sandbox: true,
      requires_full_test_suite: true,
    },
  };

  gene.asset_id = computeAssetId(gene as unknown as Record<string, unknown>);
  return gene;
}

/**
 * Initialize all predefined src/ optimization Genes
 */
export function initializeSrcGenes(): SrcOptimizationGene[] {
  const genes = PREDEFINED_SRC_GENES.map(createSrcOptimizationGene);

  for (const gene of genes) {
    upsertGene(gene as unknown as Parameters<typeof upsertGene>[0]);
  }

  return genes;
}

/**
 * Validate that src/ changes conform to the defined constraints
 */
export function validateSrcChanges(
  changedFiles: string[],
  blastRadius: BlastRadius,
): SrcValidationResult {
  const violations: string[] = [];

  // 1. Check file count
  if (blastRadius.files > SRC_OPTIMIZATION_CONSTRAINTS.max_files) {
    violations.push(
      `File count exceeded: ${blastRadius.files} > ${SRC_OPTIMIZATION_CONSTRAINTS.max_files}`,
    );
  }

  // 2. Check changed line count
  if (blastRadius.lines > SRC_OPTIMIZATION_CONSTRAINTS.max_lines) {
    violations.push(
      `Changed line count exceeded: ${blastRadius.lines} > ${SRC_OPTIMIZATION_CONSTRAINTS.max_lines}`,
    );
  }

  // 3. Check whether any forbidden paths were modified
  const forbiddenPaths = SRC_OPTIMIZATION_CONSTRAINTS.forbidden_paths;
  for (const file of changedFiles) {
    for (const forbidden of forbiddenPaths) {
      if (file.startsWith(forbidden + "/") || file === forbidden) {
        violations.push(`Forbidden path modified: ${file}`);
      }
    }
  }

  // 4. Check for files outside src/
  const nonSrcFiles = changedFiles.filter((f) => !f.startsWith("src/"));
  if (nonSrcFiles.length > 0) {
    violations.push(`Contains non-src/ files: ${nonSrcFiles.join(", ")}`);
  }

  // 5. Check for high-risk files
  const highRiskFiles = changedFiles.filter(isHighRiskFile);
  if (highRiskFiles.length > 0) {
    violations.push(
      `High-risk files modified (extra validation required): ${highRiskFiles.join(", ")}`,
    );
  }

  return {
    ok: violations.length === 0,
    violations,
    high_risk_files: highRiskFiles,
    requires_extra_validation: highRiskFiles.length > 0,
  };
}

/**
 * Test src/ changes in a sandbox environment
 */
export function testInSandbox(
  params: TestInSandboxParams,
): ReturnType<typeof import("./sandbox-runner.js").runInSandbox> {
  // Lazy import to avoid circular dependency at module load time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runInSandbox } = require("./sandbox-runner.js") as typeof import("./sandbox-runner.js");
  const { repoRoot, commands } = params;

  return runInSandbox({
    workspaceRoot: repoRoot || getRepoRoot(),
    commands: commands || SRC_OPTIMIZATION_CONSTRAINTS.required_tests,
  });
}

/**
 * Record an error as a GEP event (appended to errors.jsonl)
 */
export function recordError(params: RecordErrorParams): ErrorEvent {
  const { errorType, errorMessage, changedFiles = [], blastRadius = {}, testResults = {} } = params;

  const errorEvent: ErrorEvent = {
    type: "ErrorRecord",
    schema_version: SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    error_type: errorType,
    error_message: errorMessage,
    context: {
      changed_files: changedFiles,
      blast_radius: blastRadius,
      test_results: testResults,
    },
  };

  // Write to error log
  const errorLogPath = path.join(getGepAssetsDir(), "errors.jsonl");

  fs.appendFileSync(errorLogPath, JSON.stringify(errorEvent) + "\n");

  return errorEvent;
}
