import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

let configOverride: ReturnType<(typeof import("../config/config.js"))["loadConfig"]> = {
  session: {
    mainKey: "main",
    scope: "per-sender",
  },
};

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => configOverride,
    resolveGatewayPort: () => 18789,
  };
});

import "./test-helpers/fast-core-tools.js";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";
import { createVersoTools } from "./verso-tools.js";

describe("verso-tools: subagents auth", () => {
  beforeEach(() => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
    };
  });

  it("sessions_spawn propagates currentAuthProfileId to gateway", async () => {
    resetSubagentRegistryForTests();
    callGatewayMock.mockReset();
    const calls: Array<{ method?: string; params?: unknown }> = [];

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: unknown };
      calls.push(request);
      if (request.method === "sessions.patch") {
        return { ok: true };
      }
      if (request.method === "agent") {
        return {
          runId: "run-auth-test",
          status: "accepted",
        };
      }
      return {};
    });

    const TEST_AUTH_PROFILE = "auth-prof-xyz";

    const tool = createVersoTools({
      agentSessionKey: "discord:group:req",
      agentSurface: "discord",
      currentAuthProfileId: TEST_AUTH_PROFILE,
    }).find((candidate) => candidate.name === "sessions_spawn");

    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    await tool.execute("call-auth", {
      task: "do thing with auth",
    });

    const agentCall = calls.find((call) => call.method === "agent");
    expect(agentCall).toBeDefined();
    expect(agentCall?.params).toMatchObject({
      authProfileId: TEST_AUTH_PROFILE,
    });
  });
});
