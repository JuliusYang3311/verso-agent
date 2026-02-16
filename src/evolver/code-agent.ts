/**
 * code-agent.ts
 * Provides code modification capabilities to the evolver.
 * Uses exec/read/write operations to apply source code changes
 * proposed by the evolution engine.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CodeAgentResult } from "./runner.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const logger = createSubsystemLogger("evolver-code-agent");

export type CodeChange = {
  filePath: string;
  action: "create" | "edit" | "delete";
  content?: string;
  /** For edits: the old content to replace. */
  oldContent?: string;
  /** For edits: the new content. */
  newContent?: string;
};

export type CodeAgentParams = {
  prompt: string;
  workspace: string;
  changes?: CodeChange[];
  /** If true, validate changes in sandbox before applying. */
  sandboxValidate?: boolean;
  /** If true, require user review before applying src/ changes. */
  requireReview?: boolean;
};

/**
 * Apply code changes to the workspace.
 * This is the code agent capability that the evolver uses to modify src/ files.
 */
export async function applyCodeChanges(params: CodeAgentParams): Promise<CodeAgentResult> {
  const { workspace, changes, sandboxValidate } = params;

  if (!changes || changes.length === 0) {
    return { ok: true, filesChanged: [] };
  }

  const filesChanged: string[] = [];

  try {
    for (const change of changes) {
      const fullPath = path.isAbsolute(change.filePath)
        ? change.filePath
        : path.join(workspace, change.filePath);

      switch (change.action) {
        case "create": {
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(fullPath, change.content ?? "");
          filesChanged.push(change.filePath);
          break;
        }
        case "edit": {
          if (!fs.existsSync(fullPath)) {
            logger.warn("code-agent: file not found for edit", { path: change.filePath });
            continue;
          }
          if (change.oldContent != null && change.newContent != null) {
            const current = fs.readFileSync(fullPath, "utf-8");
            if (!current.includes(change.oldContent)) {
              logger.warn("code-agent: old content not found in file", { path: change.filePath });
              continue;
            }
            fs.writeFileSync(fullPath, current.replace(change.oldContent, change.newContent));
          } else if (change.content != null) {
            fs.writeFileSync(fullPath, change.content);
          }
          filesChanged.push(change.filePath);
          break;
        }
        case "delete": {
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            filesChanged.push(change.filePath);
          }
          break;
        }
      }
    }

    // Optionally validate in sandbox
    if (sandboxValidate && filesChanged.length > 0) {
      const validation = validateInSandbox(workspace);
      if (!validation.ok) {
        // Rollback changes
        rollbackFiles(workspace, filesChanged);
        return {
          ok: false,
          filesChanged,
          error: `Sandbox validation failed: ${validation.error}`,
        };
      }
    }

    logger.info("code-agent: changes applied", { fileCount: filesChanged.length });
    return { ok: true, filesChanged };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn("code-agent: failed to apply changes", { error: msg });
    return { ok: false, filesChanged, error: msg };
  }
}

/**
 * Run build validation in the workspace.
 */
function validateInSandbox(workspace: string): { ok: boolean; error?: string } {
  const result = spawnSync("pnpm", ["build"], {
    cwd: workspace,
    encoding: "utf-8",
    timeout: 120_000,
  });

  if (result.status === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    error: (result.stderr ?? "").slice(0, 2000),
  };
}

/**
 * Rollback file changes using git restore.
 */
function rollbackFiles(workspace: string, files: string[]): void {
  if (files.length === 0) {
    return;
  }
  spawnSync("git", ["restore", "--", ...files], {
    cwd: workspace,
    encoding: "utf-8",
  });
  logger.info("code-agent: rolled back files", { fileCount: files.length });
}

/**
 * Create a code agent function that can be passed to the evolver runner.
 */
export function createEvolverCodeAgent(_options: {
  workspace: string;
  sandboxValidate?: boolean;
  requireReview?: boolean;
}): (params: { prompt: string; workspace: string }) => Promise<CodeAgentResult> {
  return async (params) => {
    // For now, the code agent validates existing changes (from evolution)
    // rather than generating new ones from the prompt.
    // The evolution engine (evolve.js) generates the changes,
    // and this agent validates and ensures they compile.
    const validation = validateInSandbox(params.workspace);
    if (!validation.ok) {
      return {
        ok: false,
        error: `Build validation failed after evolution: ${validation.error}`,
      };
    }
    return { ok: true };
  };
}
