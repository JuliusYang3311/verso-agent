import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs(["node", "verso", "gateway", "--dev", "--allow-unconfigured"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "verso", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "verso", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "verso", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "verso", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "verso", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "verso", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs(["node", "verso", "--dev", "--profile", "work", "status"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs(["node", "verso", "--profile", "work", "--dev", "status"]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join("/home/peter", ".verso-dev");
    expect(env.VERSO_PROFILE).toBe("dev");
    expect(env.VERSO_STATE_DIR).toBe(expectedStateDir);
    expect(env.VERSO_CONFIG_PATH).toBe(path.join(expectedStateDir, "verso.json"));
    expect(env.VERSO_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      VERSO_STATE_DIR: "/custom",
      VERSO_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.VERSO_STATE_DIR).toBe("/custom");
    expect(env.VERSO_GATEWAY_PORT).toBe("19099");
    expect(env.VERSO_CONFIG_PATH).toBe(path.join("/custom", "verso.json"));
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("verso doctor --fix", {})).toBe("verso doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(formatCliCommand("verso doctor --fix", { VERSO_PROFILE: "default" })).toBe(
      "verso doctor --fix",
    );
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(formatCliCommand("verso doctor --fix", { VERSO_PROFILE: "Default" })).toBe(
      "verso doctor --fix",
    );
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(formatCliCommand("verso doctor --fix", { VERSO_PROFILE: "bad profile" })).toBe(
      "verso doctor --fix",
    );
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(formatCliCommand("verso --profile work doctor --fix", { VERSO_PROFILE: "work" })).toBe(
      "verso --profile work doctor --fix",
    );
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("verso --dev doctor", { VERSO_PROFILE: "dev" })).toBe(
      "verso --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("verso doctor --fix", { VERSO_PROFILE: "work" })).toBe(
      "verso --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("verso doctor --fix", { VERSO_PROFILE: "  jbverso  " })).toBe(
      "verso --profile jbverso doctor --fix",
    );
  });

  it("handles command with no args after verso", () => {
    expect(formatCliCommand("verso", { VERSO_PROFILE: "test" })).toBe("verso --profile test");
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm verso doctor", { VERSO_PROFILE: "work" })).toBe(
      "pnpm verso --profile work doctor",
    );
  });
});
