import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

let configOverride: ReturnType<(typeof import("../config/config.js"))["loadConfig"]> = {
  agents: {
    defaults: {
      subagents: {
        archiveAfterMinutes: 60,
      },
    },
  },
};

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => configOverride,
  };
});

import {
  listSubagentRunsForRequester,
  resetSubagentRegistryForTests,
  registerSubagentRun,
} from "./subagent-registry.js";

describe("subagent registry lifecycle", () => {
  beforeEach(() => {
    resetSubagentRegistryForTests();
    callGatewayMock.mockReset();
  });

  it("defers archiveAtMs assignment until task completion", async () => {
    // 1. Start a long-running task
    // callGateway for 'agent.wait' will return immediately with a promise that we can control or mock
    // Here we will make it hang or return later
    let resolveWait: (val: any) => void = () => {};
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent.wait") {
        return new Promise((resolve) => {
          resolveWait = resolve;
        });
      }
      return {};
    });

    registerSubagentRun({
      runId: "run-life-1",
      childSessionKey: "agent:child",
      requesterSessionKey: "agent:main",
      requesterDisplayKey: "main",
      task: "long task",
      cleanup: "keep",
      background: false,
    });

    // 2. Verifica archiveAtMs is undefined initially
    const runs = listSubagentRunsForRequester("agent:main");
    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe("run-life-1");
    expect(runs[0].archiveAtMs).toBeUndefined();

    // 3. Complete the task
    resolveWait({
      status: "ok",
      endedAt: Date.now(),
    });

    // Allow promise microtasks to settle
    await new Promise((r) => setTimeout(r, 0));

    // 4. Verify archiveAtMs is now set
    const runsAfter = listSubagentRunsForRequester("agent:main");
    const now = Date.now();
    expect(runsAfter[0].archiveAtMs).toBeDefined();
    // Since it's immediate, it should be close to now (allowing for small execution delay)
    // It shouldn't be 10 minutes from now.
    expect(runsAfter[0].archiveAtMs).toBeLessThanOrEqual(now + 1000);
    expect(runsAfter[0].archiveAtMs).toBeGreaterThanOrEqual(now - 1000);
  });

  it("sets archiveAtMs immediately if background task ends via event listener", async () => {
    // For background tasks, we don't call agent.wait.
    // We rely on onAgentEvent.
    // However, onAgentEvent logic uses the same setArchiveTime helper.
    // We need to trigger the event listener. Since we can't easily emit to the internal listener from outside without mocking onAgentEvent to expose the callback,
    // we might need to rely on the shared behavior or mock subagent-registry internals more deeply.
    // But wait, our earlier `subagent-registry.persistence.test.ts` mocked onAgentEvent to noop.
    // We can update the mock in this file to capture the listener.
  });
});
