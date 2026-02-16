import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../cli/deps.js";
import type { VersoConfig } from "../config/config.js";
import type { CronJob } from "./types.js";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
import { telegramOutbound } from "../channels/plugins/outbound/telegram.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createOutboundTestPlugin, createTestRegistry } from "../test-utils/channel-plugins.js";

vi.mock("../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  runEmbeddedPiAgent: vi.fn(),
  resolveEmbeddedSessionLane: (key: string) => `session:${key.trim() || "main"}`,
}));
vi.mock("../agents/model-catalog.js", () => ({
  loadModelCatalog: vi.fn(),
}));

import { loadModelCatalog } from "../agents/model-catalog.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
import { runCronIsolatedAgentTurn } from "./isolated-agent.js";

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  return withTempHomeBase(fn, { prefix: "verso-cron-" });
}

async function writeSessionStore(home: string) {
  const dir = path.join(home, ".verso", "sessions");
  await fs.mkdir(dir, { recursive: true });
  const storePath = path.join(dir, "sessions.json");
  await fs.writeFile(
    storePath,
    JSON.stringify(
      {
        "agent:main:main": {
          sessionId: "main-session",
          updatedAt: Date.now(),
          lastProvider: "webchat",
          lastTo: "",
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
  return storePath;
}

function makeCfg(
  home: string,
  storePath: string,
  overrides: Partial<VersoConfig> = {},
): VersoConfig {
  const base: VersoConfig = {
    agents: {
      defaults: {
        model: "anthropic/claude-opus-4-5",
        workspace: path.join(home, "verso"),
      },
    },
    session: { store: storePath, mainKey: "main" },
  } as VersoConfig;
  return { ...base, ...overrides };
}

function makeJob(payload: CronJob["payload"]): CronJob {
  const now = Date.now();
  return {
    id: "job-1",
    name: "job-1",
    enabled: true,
    createdAtMs: now,
    updatedAtMs: now,
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload,
    state: {},
  };
}

describe("runCronIsolatedAgentTurn", () => {
  beforeEach(() => {
    vi.mocked(runEmbeddedPiAgent).mockReset();
    vi.mocked(loadModelCatalog).mockResolvedValue([]);
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "telegram",
          plugin: createOutboundTestPlugin({ id: "telegram", outbound: telegramOutbound }),
          source: "test",
        },
      ]),
    );
  });

  it("delivers via outbound when delivery is requested", async () => {
    await withTempHome(async (home) => {
      const storePath = await writeSessionStore(home);
      const deps: CliDeps = {
        sendMessageWhatsApp: vi.fn(),
        sendMessageTelegram: vi.fn().mockResolvedValue({
          messageId: "t1",
          chatId: "123",
        }),
        sendMessageDiscord: vi.fn(),
        sendMessageSignal: vi.fn(),
        sendMessageIMessage: vi.fn(),
      };
      vi.mocked(runEmbeddedPiAgent).mockResolvedValue({
        payloads: [{ text: "hello from cron" }],
        meta: {
          durationMs: 5,
          agentMeta: { sessionId: "s", provider: "p", model: "m" },
        },
      });

      const res = await runCronIsolatedAgentTurn({
        cfg: makeCfg(home, storePath, {
          channels: { telegram: { botToken: "t-1" } },
        }),
        deps,
        job: {
          ...makeJob({ kind: "agentTurn", message: "do it" }),
          delivery: { mode: "announce", channel: "telegram", to: "123" },
        },
        message: "do it",
        sessionKey: "cron:job-1",
        lane: "cron",
      });

      expect(res.status).toBe("ok");
      expect(deps.sendMessageTelegram).toHaveBeenCalled();
    });
  });

  it("delivers final payload text via outbound", async () => {
    await withTempHome(async (home) => {
      const storePath = await writeSessionStore(home);
      const deps: CliDeps = {
        sendMessageWhatsApp: vi.fn(),
        sendMessageTelegram: vi.fn().mockResolvedValue({
          messageId: "t1",
          chatId: "123",
        }),
        sendMessageDiscord: vi.fn(),
        sendMessageSignal: vi.fn(),
        sendMessageIMessage: vi.fn(),
      };
      vi.mocked(runEmbeddedPiAgent).mockResolvedValue({
        payloads: [{ text: "Working on it..." }, { text: "Final weather summary" }],
        meta: {
          durationMs: 5,
          agentMeta: { sessionId: "s", provider: "p", model: "m" },
        },
      });

      const res = await runCronIsolatedAgentTurn({
        cfg: makeCfg(home, storePath, {
          channels: { telegram: { botToken: "t-1" } },
        }),
        deps,
        job: {
          ...makeJob({ kind: "agentTurn", message: "do it" }),
          delivery: { mode: "announce", channel: "telegram", to: "123" },
        },
        message: "do it",
        sessionKey: "cron:job-1",
        lane: "cron",
      });

      expect(res.status).toBe("ok");
      expect(deps.sendMessageTelegram).toHaveBeenCalled();
    });
  });

  it("resolves delivery target from session store last channel", async () => {
    await withTempHome(async (home) => {
      const storePath = await writeSessionStore(home);
      await fs.writeFile(
        storePath,
        JSON.stringify(
          {
            "agent:main:main": {
              sessionId: "main-session",
              updatedAt: Date.now(),
              lastChannel: "telegram",
              lastTo: "123",
              lastThreadId: 42,
            },
          },
          null,
          2,
        ),
        "utf-8",
      );
      const deps: CliDeps = {
        sendMessageWhatsApp: vi.fn(),
        sendMessageTelegram: vi.fn().mockResolvedValue({
          messageId: "t1",
          chatId: "123",
        }),
        sendMessageDiscord: vi.fn(),
        sendMessageSignal: vi.fn(),
        sendMessageIMessage: vi.fn(),
      };
      vi.mocked(runEmbeddedPiAgent).mockResolvedValue({
        payloads: [{ text: "Final weather summary" }],
        meta: {
          durationMs: 5,
          agentMeta: { sessionId: "s", provider: "p", model: "m" },
        },
      });

      const res = await runCronIsolatedAgentTurn({
        cfg: makeCfg(home, storePath, {
          channels: { telegram: { botToken: "t-1" } },
        }),
        deps,
        job: {
          ...makeJob({ kind: "agentTurn", message: "do it" }),
          delivery: { mode: "announce", channel: "last" },
        },
        message: "do it",
        sessionKey: "cron:job-1",
        lane: "cron",
      });

      expect(res.status).toBe("ok");
      expect(deps.sendMessageTelegram).toHaveBeenCalled();
    });
  });

  it("skips delivery when messaging tool already sent to target", async () => {
    await withTempHome(async (home) => {
      const storePath = await writeSessionStore(home);
      const deps: CliDeps = {
        sendMessageWhatsApp: vi.fn(),
        sendMessageTelegram: vi.fn(),
        sendMessageDiscord: vi.fn(),
        sendMessageSignal: vi.fn(),
        sendMessageIMessage: vi.fn(),
      };
      vi.mocked(runEmbeddedPiAgent).mockResolvedValue({
        payloads: [{ text: "sent" }],
        meta: {
          durationMs: 5,
          agentMeta: { sessionId: "s", provider: "p", model: "m" },
        },
        didSendViaMessagingTool: true,
        messagingToolSentTargets: [{ tool: "message", provider: "telegram", to: "123" }],
      });

      const res = await runCronIsolatedAgentTurn({
        cfg: makeCfg(home, storePath, {
          channels: { telegram: { botToken: "t-1" } },
        }),
        deps,
        job: {
          ...makeJob({ kind: "agentTurn", message: "do it" }),
          delivery: { mode: "announce", channel: "telegram", to: "123" },
        },
        message: "do it",
        sessionKey: "cron:job-1",
        lane: "cron",
      });

      expect(res.status).toBe("ok");
      expect(deps.sendMessageTelegram).not.toHaveBeenCalled();
    });
  });

  it("skips delivery for heartbeat-only output", async () => {
    await withTempHome(async (home) => {
      const storePath = await writeSessionStore(home);
      const deps: CliDeps = {
        sendMessageWhatsApp: vi.fn(),
        sendMessageTelegram: vi.fn(),
        sendMessageDiscord: vi.fn(),
        sendMessageSignal: vi.fn(),
        sendMessageIMessage: vi.fn(),
      };
      vi.mocked(runEmbeddedPiAgent).mockResolvedValue({
        payloads: [{ text: "HEARTBEAT_OK" }],
        meta: {
          durationMs: 5,
          agentMeta: { sessionId: "s", provider: "p", model: "m" },
        },
      });

      const res = await runCronIsolatedAgentTurn({
        cfg: makeCfg(home, storePath, {
          channels: { telegram: { botToken: "t-1" } },
        }),
        deps,
        job: {
          ...makeJob({ kind: "agentTurn", message: "do it" }),
          delivery: { mode: "announce", channel: "telegram", to: "123" },
        },
        message: "do it",
        sessionKey: "cron:job-1",
        lane: "cron",
      });

      expect(res.status).toBe("ok");
      expect(deps.sendMessageTelegram).not.toHaveBeenCalled();
    });
  });

  it("fails when outbound delivery fails and best-effort is disabled", async () => {
    await withTempHome(async (home) => {
      const storePath = await writeSessionStore(home);
      const deps: CliDeps = {
        sendMessageWhatsApp: vi.fn(),
        sendMessageTelegram: vi.fn().mockRejectedValue(new Error("boom")),
        sendMessageDiscord: vi.fn(),
        sendMessageSignal: vi.fn(),
        sendMessageIMessage: vi.fn(),
      };
      vi.mocked(runEmbeddedPiAgent).mockResolvedValue({
        payloads: [{ text: "hello from cron" }],
        meta: {
          durationMs: 5,
          agentMeta: { sessionId: "s", provider: "p", model: "m" },
        },
      });
      const res = await runCronIsolatedAgentTurn({
        cfg: makeCfg(home, storePath, {
          channels: { telegram: { botToken: "t-1" } },
        }),
        deps,
        job: {
          ...makeJob({ kind: "agentTurn", message: "do it" }),
          delivery: { mode: "announce", channel: "telegram", to: "123" },
        },
        message: "do it",
        sessionKey: "cron:job-1",
        lane: "cron",
      });

      expect(res.status).toBe("error");
    });
  });

  it("ignores outbound delivery failures when best-effort is enabled", async () => {
    await withTempHome(async (home) => {
      const storePath = await writeSessionStore(home);
      const deps: CliDeps = {
        sendMessageWhatsApp: vi.fn(),
        sendMessageTelegram: vi.fn().mockRejectedValue(new Error("boom")),
        sendMessageDiscord: vi.fn(),
        sendMessageSignal: vi.fn(),
        sendMessageIMessage: vi.fn(),
      };
      vi.mocked(runEmbeddedPiAgent).mockResolvedValue({
        payloads: [{ text: "hello from cron" }],
        meta: {
          durationMs: 5,
          agentMeta: { sessionId: "s", provider: "p", model: "m" },
        },
      });
      const res = await runCronIsolatedAgentTurn({
        cfg: makeCfg(home, storePath, {
          channels: { telegram: { botToken: "t-1" } },
        }),
        deps,
        job: {
          ...makeJob({ kind: "agentTurn", message: "do it" }),
          delivery: {
            mode: "announce",
            channel: "telegram",
            to: "123",
            bestEffort: true,
          },
        },
        message: "do it",
        sessionKey: "cron:job-1",
        lane: "cron",
      });

      expect(res.status).toBe("ok");
    });
  });
});
