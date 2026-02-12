import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGatewayStateDir } from "./paths.js";

describe("resolveGatewayStateDir", () => {
  it("uses the default state dir when no overrides are set", () => {
    const env = { HOME: "/Users/test" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".verso"));
  });

  it("appends the profile suffix when set", () => {
    const env = { HOME: "/Users/test", VERSO_PROFILE: "rescue" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".verso-rescue"));
  });

  it("treats default profiles as the base state dir", () => {
    const env = { HOME: "/Users/test", VERSO_PROFILE: "Default" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".verso"));
  });

  it("uses VERSO_STATE_DIR when provided", () => {
    const env = { HOME: "/Users/test", VERSO_STATE_DIR: "/var/lib/verso" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/var/lib/verso"));
  });

  it("expands ~ in VERSO_STATE_DIR", () => {
    const env = { HOME: "/Users/test", VERSO_STATE_DIR: "~/verso-state" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/Users/test/verso-state"));
  });

  it("preserves Windows absolute paths without HOME", () => {
    const env = { VERSO_STATE_DIR: "C:\\State\\verso" };
    expect(resolveGatewayStateDir(env)).toBe("C:\\State\\verso");
  });
});
