import type { CommandHandler } from "./commands-types.js";
import {
  getEvolverStatus,
  readEvolverRollbackInfo,
  startEvolverDaemon,
  stopEvolverDaemon,
} from "../../agents/evolver.js";
import { logVerbose } from "../../globals.js";

function shouldHandle(command: string, prefix: string) {
  return command === prefix || command.startsWith(`${prefix} `);
}

function parseEvolveMode(body: string): "on" | "off" | "status" {
  const trimmed = body.trim();
  if (trimmed === "/evolve") {
    return "on";
  }
  const rest = trimmed.slice("/evolve".length).trim();
  if (!rest) {
    return "on";
  }
  if (rest === "off") {
    return "off";
  }
  if (rest === "status") {
    return "status";
  }
  if (rest === "on") {
    return "on";
  }
  return "status";
}

export const handleEvolverCommand: CommandHandler = async (params) => {
  const body = params.command.commandBodyNormalized;
  if (!shouldHandle(body, "/evolve") && !shouldHandle(body, "/evolveoff")) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring evolve command from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  if (shouldHandle(body, "/evolveoff")) {
    const result = await stopEvolverDaemon();
    const reply = result.stopped
      ? `🧬 Evolver stopped (pid ${result.pid ?? "unknown"}).`
      : "🧬 Evolver is not running.";
    return { shouldContinue: false, reply: { text: reply } };
  }

  const mode = parseEvolveMode(body);
  if (mode === "status") {
    const status = await getEvolverStatus();
    const rollbackInfo = await readEvolverRollbackInfo();
    const lines = [
      status.running
        ? `🧬 Evolver running (pid ${status.pid ?? "unknown"}).`
        : "🧬 Evolver is not running.",
      `Log: ${status.logPath}`,
      rollbackInfo ? `Last rollback:\n${rollbackInfo}` : "Last rollback: (none)",
    ];
    return { shouldContinue: false, reply: { text: lines.join("\n") } };
  }

  if (mode === "off") {
    const result = await stopEvolverDaemon();
    const reply = result.stopped
      ? `🧬 Evolver stopped (pid ${result.pid ?? "unknown"}).`
      : "🧬 Evolver is not running.";
    return { shouldContinue: false, reply: { text: reply } };
  }

  const start = await startEvolverDaemon(params.cfg);
  if (!start.started) {
    const error = start.error ? ` ${start.error}` : "";
    return {
      shouldContinue: false,
      reply: {
        text: `🧬 Evolver already running (pid ${start.pid ?? "unknown"}). Log: ${start.logPath}${error}`,
      },
    };
  }
  return {
    shouldContinue: false,
    reply: {
      text: `🧬 Evolver started (pid ${start.pid}). Log: ${start.logPath}`,
    },
  };
};
