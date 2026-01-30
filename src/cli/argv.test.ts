import { describe, expect, it } from "vitest";

import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "verso", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "verso", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "verso", "status"])).toBe(false);
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "verso", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "verso", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "verso", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "verso", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "verso"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "verso", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "verso", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "verso", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "verso", "status", "--timeout=2500"], "--timeout")).toBe("2500");
    expect(getFlagValue(["node", "verso", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "verso", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "verso", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "verso", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "verso", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "verso", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "verso", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "verso", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "verso", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "verso", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "verso",
      rawArgs: ["node", "verso", "status"],
    });
    expect(nodeArgv).toEqual(["node", "verso", "status"]);

    const versionedNodeArgv = buildParseArgv({
      programName: "verso",
      rawArgs: ["node-22", "verso", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "verso", "status"]);

    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "verso",
      rawArgs: ["node-22.2.0.exe", "verso", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "verso", "status"]);

    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "verso",
      rawArgs: ["node-22.2", "verso", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "verso", "status"]);

    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "verso",
      rawArgs: ["node-22.2.exe", "verso", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "verso", "status"]);

    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "verso",
      rawArgs: ["/usr/bin/node-22.2.0", "verso", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "verso", "status"]);

    const nodejsArgv = buildParseArgv({
      programName: "verso",
      rawArgs: ["nodejs", "verso", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "verso", "status"]);

    const nonVersionedNodeArgv = buildParseArgv({
      programName: "verso",
      rawArgs: ["node-dev", "verso", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "verso", "node-dev", "verso", "status"]);

    const directArgv = buildParseArgv({
      programName: "verso",
      rawArgs: ["verso", "status"],
    });
    expect(directArgv).toEqual(["node", "verso", "status"]);

    const bunArgv = buildParseArgv({
      programName: "verso",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "verso",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "verso", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "verso", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "verso", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "verso", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "verso", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "verso", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "verso", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "verso", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
