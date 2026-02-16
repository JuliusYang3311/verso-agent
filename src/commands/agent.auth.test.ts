import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";

vi.mock("../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  runEmbeddedPiAgent: vi.fn(),
  resolveEmbeddedSessionLane: (key: string) => `session:${key.trim() || "main"}`,
}));
vi.mock("../agents/model-catalog.js", () => ({
  loadModelCatalog: vi.fn(),
}));
vi.mock("../agents/auth-profiles.js", () => ({
  ensureAuthProfileStore: vi.fn(() => ({
    profiles: {
      "test-profile-123": {
        provider: "anthropic",
        mode: "api_key",
        type: "api_key",
      },
    },
  })),
  resolveAuthProfileOrder: vi.fn(() => []),
}));

import type { RuntimeEnv } from "../runtime.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
import * as configModule from "../config/config.js";
import { agentCommand } from "./agent.js";

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(() => {
    throw new Error("exit");
  }),
};

const configSpy = vi.spyOn(configModule, "loadConfig");

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  return withTempHomeBase(fn, { prefix: "verso-agent-" });
}

function mockConfig(home: string, storePath: string) {
  configSpy.mockReturnValue({
    agents: {
      defaults: {
        model: { primary: "anthropic/claude-opus-4-5" },
        models: { "anthropic/claude-opus-4-5": {} },
        workspace: path.join(home, "verso"),
      },
    },
    session: { store: storePath, mainKey: "main" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runEmbeddedPiAgent).mockResolvedValue({
    payloads: [{ text: "ok" }],
    meta: {
      durationMs: 5,
      agentMeta: { sessionId: "s", provider: "p", model: "m" },
    },
  });
  vi.mocked(loadModelCatalog).mockResolvedValue([]);
});

describe("agentCommand auth profile propagation", () => {
  it("propagates authProfileId to runEmbeddedPiAgent", async () => {
    await withTempHome(async (home) => {
      const store = path.join(home, "sessions.json");
      mockConfig(home, store);

      await agentCommand(
        {
          message: "test auth",
          to: "+1555",
          authProfileId: "test-profile-123",
        },
        runtime,
      );

      const callArgs = vi.mocked(runEmbeddedPiAgent).mock.calls.at(-1)?.[0];
      expect(callArgs).toBeDefined();
      expect(callArgs?.authProfileId).toBe("test-profile-123");
    });
  });
});
