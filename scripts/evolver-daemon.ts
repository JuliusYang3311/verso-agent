import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function writeLog(logPath: string, line: string): void {
  fs.appendFileSync(logPath, `${line}\n`);
}

function runCommand(command: string, cwd: string, env: NodeJS.ProcessEnv): RunResult {
  const result = spawnSync(command, {
    cwd,
    env,
    shell: true,
    encoding: "utf-8",
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }
  return fallback;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const evolverDir = process.env.EVOLVER_DIR?.trim();
  const workspace = process.env.OPENCLAW_WORKSPACE?.trim() || process.cwd();
  const verifyCmd = process.env.EVOLVER_VERIFY_CMD?.trim() || "pnpm build";
  const rollbackEnabled = parseBool(process.env.EVOLVER_ROLLBACK, true);
  const cleanEnabled = parseBool(process.env.EVOLVER_CLEAN, true);
  const logPath =
    process.env.EVOLVER_LOG_PATH?.trim() || path.join(process.cwd(), "logs", "evolver-daemon.log");
  const rollbackReportPath =
    process.env.EVOLVER_ROLLBACK_REPORT_PATH?.trim() ||
    path.join(process.cwd(), "logs", "evolver-daemon.rollback.json");
  const runArgs = (process.env.EVOLVER_RUN_ARGS?.trim() || "run")
    .split(" ")
    .filter(Boolean)
    .join(" ");

  if (!evolverDir) {
    writeLog(logPath, `[${nowIso()}] evolver-daemon: missing EVOLVER_DIR`);
    process.exit(1);
  }

  writeLog(
    logPath,
    `[${nowIso()}] evolver-daemon: start (dir=${evolverDir}, workspace=${workspace})`,
  );
  writeLog(logPath, `[${nowIso()}] evolver-daemon: env OPENCLAW_WORKSPACE=${workspace}`);
  const memoryPath = path.join(workspace, "MEMORY.md");
  writeLog(
    logPath,
    `[${nowIso()}] evolver-daemon: MEMORY.md ${fs.existsSync(memoryPath) ? "present" : "missing"} (${memoryPath})`,
  );

  while (true) {
    const runResult = runCommand(`node index.js ${runArgs}`, evolverDir, {
      ...process.env,
      OPENCLAW_WORKSPACE: workspace,
    });
    writeLog(logPath, `[${nowIso()}] evolver-daemon: run exit=${runResult.code}`);

    if (runResult.code === 0) {
      const verifyResult = runCommand(verifyCmd, workspace, process.env);
      writeLog(logPath, `[${nowIso()}] evolver-daemon: verify exit=${verifyResult.code}`);
      if (verifyResult.code !== 0 && rollbackEnabled) {
        const rollbackResult = runCommand(
          "git restore --staged --worktree .",
          workspace,
          process.env,
        );
        const cleanResult = cleanEnabled
          ? runCommand("git clean -fd", workspace, process.env)
          : { code: 0, stdout: "", stderr: "" };
        const report = {
          timestamp: nowIso(),
          reason: "verify_failed",
          verify: verifyResult,
          rollback: rollbackResult,
          clean: cleanResult,
        };
        fs.writeFileSync(rollbackReportPath, JSON.stringify(report, null, 2));
        writeLog(logPath, `[${nowIso()}] evolver-daemon: rollback complete`);
      }
    } else if (rollbackEnabled) {
      const rollbackResult = runCommand(
        "git restore --staged --worktree .",
        workspace,
        process.env,
      );
      const cleanResult = cleanEnabled
        ? runCommand("git clean -fd", workspace, process.env)
        : { code: 0, stdout: "", stderr: "" };
      const report = {
        timestamp: nowIso(),
        reason: "run_failed",
        run: runResult,
        rollback: rollbackResult,
        clean: cleanResult,
      };
      fs.writeFileSync(rollbackReportPath, JSON.stringify(report, null, 2));
      writeLog(logPath, `[${nowIso()}] evolver-daemon: rollback complete`);
    }

    await sleep(1000);
  }
}

main().catch((error) => {
  const logPath = process.env.EVOLVER_LOG_PATH?.trim();
  if (logPath) {
    writeLog(logPath, `[${nowIso()}] evolver-daemon: fatal ${String(error)}`);
  }
  process.exit(1);
});
