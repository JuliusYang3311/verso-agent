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

describe("verso-tools: subagents auth patch", () => {
  beforeEach(() => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
    };
  });

  it("sessions_spawn patches currentAuthProfileId to session alongside model", async () => {
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
          runId: "run-auth-patch-test",
          status: "accepted",
        };
      }
      return {};
    });

    const TEST_AUTH_PROFILE = "auth-prof-patch-test";
    const TEST_MODEL = "provider/model-x";

    const tool = createVersoTools({
      agentSessionKey: "discord:group:req-patch",
      agentSurface: "discord",
      currentAuthProfileId: TEST_AUTH_PROFILE,
      currentModel: { provider: "provider", model: "model-x" },
    }).find((candidate) => candidate.name === "sessions_spawn");

    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    await tool.execute("call-auth-patch", {
      task: "do thing with auth patch",
    });

    const patchCall = calls.find(
      (call) => call.method === "sessions.patch" && (call.params as any).key.includes("subagent"),
    );
    expect(patchCall).toBeDefined();
    expect(patchCall?.params).toMatchObject({
      model: TEST_MODEL,
      authProfileId: TEST_AUTH_PROFILE,
    });
  });
});
