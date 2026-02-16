/**
 * daemon-entry.ts
 * Entry point for the evolver daemon process.
 * Spawned as a detached process by src/agents/evolver.ts.
 */

import { runDaemonLoop } from "./runner.js";

const review = process.env.EVOLVER_REVIEW === "true";
const workspace = process.env.VERSO_WORKSPACE || process.env.OPENCLAW_WORKSPACE;
const verifyCmd = process.env.EVOLVER_VERIFY_CMD || "pnpm lint && pnpm build && pnpm vitest run";
const model = process.env.EVOLVER_MODEL || undefined;
const agentDir = process.env.EVOLVER_AGENT_DIR || undefined;

runDaemonLoop({
  mode: "loop",
  review,
  workspace,
  verifyCmd,
  rollbackEnabled: true,
  cleanEnabled: true,
  model,
  agentDir,
}).catch((error) => {
  const logPath = process.env.EVOLVER_LOG_PATH;
  if (logPath) {
    const fs = require("node:fs");
    fs.appendFileSync(
      logPath,
      `[${new Date().toISOString()}] evolver-daemon: fatal ${String(error)}\n`,
    );
  }
  process.exit(1);
});
