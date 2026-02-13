import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

let configOverride: ReturnType<(typeof import("../../config/config.js"))["loadConfig"]> = {
  session: {
    mainKey: "main",
    scope: "per-sender",
  },
};

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => configOverride,
  };
});

import { resetSubagentRegistryForTests } from "../subagent-registry.js";
import { createSessionsSpawnTool } from "./sessions-spawn-tool.js";

describe("sessions_spawn tool: background execution", () => {
  beforeEach(() => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
    };
    resetSubagentRegistryForTests();
    callGatewayMock.mockReset();
  });

  it("does not call agent.wait when background=true", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: unknown };
      if (request.method === "agent") {
        return {
          runId: "run-bg-1",
          status: "accepted",
        };
      }
      return {};
    });

    const tool = createSessionsSpawnTool({
      agentSessionKey: "discord:group:req",
      agentChannel: "discord",
    });

    const result = await tool.execute("call1", {
      task: "do thing in background",
      background: true,
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      runId: "run-bg-1",
    });

    // We expect "agent" call (spawn) but NO "agent.wait"
    const methods = callGatewayMock.mock.calls.map((c) => (c[0] as { method: string }).method);
    expect(methods).toContain("agent");
    expect(methods).not.toContain("agent.wait");
  });

  it("calls agent.wait when background=false (default)", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: unknown };
      if (request.method === "agent") {
        return {
          runId: "run-fg-1",
          status: "accepted",
        };
      }
      if (request.method === "agent.wait") {
        return {
          status: "ok",
          endedAt: Date.now(),
        };
      }
      return {};
    });

    const tool = createSessionsSpawnTool({
      agentSessionKey: "discord:group:req",
      agentChannel: "discord",
    });

    await tool.execute("call2", {
      task: "do thing in foreground",
      // background defaults to false
    });

    // Wait a tick for the "void waitForSubagentCompletion" promise to start
    await new Promise((resolve) => setImmediate(resolve));

    const methods = callGatewayMock.mock.calls.map((c) => (c[0] as { method: string }).method);
    expect(methods).toContain("agent");
    expect(methods).toContain("agent.wait");
  });
});
