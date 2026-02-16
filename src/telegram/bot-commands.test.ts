import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetInboundDedupe } from "../auto-reply/reply/inbound-dedupe.js";
import { createBotTestSpies } from "./bot-test-helpers.js";
import { createTelegramBot } from "./bot.js";

const spies = createBotTestSpies();
const { middlewareUseSpy, onSpy, botCtorSpy, sendMessageSpy, setMyCommandsSpy, apiStub } = spies;

let replyModule: typeof import("../auto-reply/reply.js");

const { listSkillCommandsForAgents } = vi.hoisted(() => ({
  listSkillCommandsForAgents: vi.fn(() => []),
}));
vi.mock("../auto-reply/skill-commands.js", () => ({
  listSkillCommandsForAgents,
}));

const { loadWebMedia } = vi.hoisted(() => ({ loadWebMedia: vi.fn() }));
vi.mock("../web/media.js", () => ({ loadWebMedia }));

const { loadConfig } = vi.hoisted(() => ({ loadConfig: vi.fn(() => ({})) }));
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return { ...actual, loadConfig };
});

const { sessionStorePath } = vi.hoisted(() => ({
  sessionStorePath: `/tmp/verso-telegram-bot-cmd-${Math.random().toString(16).slice(2)}.json`,
}));
vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions.js")>();
  return { ...actual, resolveStorePath: vi.fn((storePath) => storePath ?? sessionStorePath) };
});

const { readChannelAllowFromStore, upsertChannelPairingRequest } = vi.hoisted(() => ({
  readChannelAllowFromStore: vi.fn(async () => [] as string[]),
  upsertChannelPairingRequest: vi.fn(async () => ({ code: "PAIRCODE", created: true })),
}));
vi.mock("../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore,
  upsertChannelPairingRequest,
}));

const { enqueueSystemEvent } = vi.hoisted(() => ({ enqueueSystemEvent: vi.fn() }));
vi.mock("../infra/system-events.js", () => ({ enqueueSystemEvent }));

const { wasSentByBot } = vi.hoisted(() => ({ wasSentByBot: vi.fn(() => false) }));
vi.mock("./sent-message-cache.js", () => ({
  wasSentByBot,
  recordSentMessage: vi.fn(),
  clearSentMessageCache: vi.fn(),
}));

vi.mock("grammy", () => ({
  Bot: class {
    api = apiStub;
    use = middlewareUseSpy;
    on = onSpy;
    stop = spies.stopSpy;
    command = spies.commandSpy;
    catch = vi.fn();
    constructor(
      public token: string,
      public options?: { client?: { fetch?: typeof fetch } },
    ) {
      botCtorSpy(token, options);
    }
  },
  InputFile: class {},
  webhookCallback: vi.fn(),
}));

vi.mock("@grammyjs/runner", () => ({ sequentialize: () => vi.fn() }));
vi.mock("@grammyjs/transformer-throttler", () => ({
  apiThrottler: () => vi.fn(() => "throttler")(),
}));

vi.mock("../auto-reply/reply.js", () => {
  const replySpy = vi.fn(
    async (
      _ctx: unknown,
      opts?: {
        onReplyStart?: () => Promise<void>;
        onToolResult?: (r: { text: string }) => Promise<void>;
      },
    ) => {
      await opts?.onReplyStart?.();
      return undefined;
    },
  );
  return { getReplyFromConfig: replySpy, __replySpy: replySpy };
});

const ORIGINAL_TZ = process.env.TZ;

describe("createTelegramBot – native commands", () => {
  beforeAll(async () => {
    replyModule = await import("../auto-reply/reply.js");
  });

  beforeEach(() => {
    process.env.TZ = "UTC";
    resetInboundDedupe();
    loadConfig.mockReturnValue({
      agents: { defaults: { envelopeTimezone: "utc" } },
      channels: { telegram: { dmPolicy: "open", allowFrom: ["*"] } },
    });
    loadWebMedia.mockReset();
    sendMessageSpy.mockReset();
    setMyCommandsSpy.mockReset();
    wasSentByBot.mockReset();
    middlewareUseSpy.mockReset();
    botCtorSpy.mockReset();
  });

  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it("sets command target session key for dm topic commands", async () => {
    onSpy.mockReset();
    sendMessageSpy.mockReset();
    spies.commandSpy.mockReset();
    const replySpy = replyModule.__replySpy as unknown as ReturnType<typeof vi.fn>;
    replySpy.mockReset();
    replySpy.mockResolvedValue({ text: "response" });

    loadConfig.mockReturnValue({
      commands: { native: true },
      channels: {
        telegram: {
          dmPolicy: "pairing",
        },
      },
    });
    readChannelAllowFromStore.mockResolvedValueOnce(["12345"]);

    createTelegramBot({ token: "tok" });
    const handler = spies.commandSpy.mock.calls.find((call) => call[0] === "status")?.[1] as
      | ((ctx: Record<string, unknown>) => Promise<void>)
      | undefined;
    if (!handler) {
      throw new Error("status command handler missing");
    }

    await handler({
      message: {
        chat: { id: 12345, type: "private" },
        from: { id: 12345, username: "testuser" },
        text: "/status",
        date: 1736380800,
        message_id: 42,
        message_thread_id: 99,
      },
      match: "",
    });

    expect(replySpy).toHaveBeenCalledTimes(1);
    const payload = replySpy.mock.calls[0][0];
    expect(payload.CommandTargetSessionKey).toBe("agent:main:main:thread:99");
  });

  it("allows native DM commands for paired users", async () => {
    onSpy.mockReset();
    sendMessageSpy.mockReset();
    spies.commandSpy.mockReset();
    const replySpy = replyModule.__replySpy as unknown as ReturnType<typeof vi.fn>;
    replySpy.mockReset();
    replySpy.mockResolvedValue({ text: "response" });

    loadConfig.mockReturnValue({
      commands: { native: true },
      channels: {
        telegram: {
          dmPolicy: "pairing",
        },
      },
    });
    readChannelAllowFromStore.mockResolvedValueOnce(["12345"]);

    createTelegramBot({ token: "tok" });
    const handler = spies.commandSpy.mock.calls.find((call) => call[0] === "status")?.[1] as
      | ((ctx: Record<string, unknown>) => Promise<void>)
      | undefined;
    if (!handler) {
      throw new Error("status command handler missing");
    }

    await handler({
      message: {
        chat: { id: 12345, type: "private" },
        from: { id: 12345, username: "testuser" },
        text: "/status",
        date: 1736380800,
        message_id: 42,
      },
      match: "",
    });

    expect(replySpy).toHaveBeenCalledTimes(1);
    expect(
      sendMessageSpy.mock.calls.some(
        (call) => call[1] === "You are not authorized to use this command.",
      ),
    ).toBe(false);
  });

  it("blocks native DM commands for unpaired users", async () => {
    onSpy.mockReset();
    sendMessageSpy.mockReset();
    spies.commandSpy.mockReset();
    const replySpy = replyModule.__replySpy as unknown as ReturnType<typeof vi.fn>;
    replySpy.mockReset();

    loadConfig.mockReturnValue({
      commands: { native: true },
      channels: {
        telegram: {
          dmPolicy: "pairing",
        },
      },
    });
    readChannelAllowFromStore.mockResolvedValueOnce([]);

    createTelegramBot({ token: "tok" });
    const handler = spies.commandSpy.mock.calls.find((call) => call[0] === "status")?.[1] as
      | ((ctx: Record<string, unknown>) => Promise<void>)
      | undefined;
    if (!handler) {
      throw new Error("status command handler missing");
    }

    await handler({
      message: {
        chat: { id: 12345, type: "private" },
        from: { id: 12345, username: "testuser" },
        text: "/status",
        date: 1736380800,
        message_id: 42,
      },
      match: "",
    });

    expect(replySpy).not.toHaveBeenCalled();
    expect(sendMessageSpy).toHaveBeenCalledWith(
      12345,
      "You are not authorized to use this command.",
    );
  });

  it("skips tool summaries for native slash commands", async () => {
    onSpy.mockReset();
    sendMessageSpy.mockReset();
    spies.commandSpy.mockReset();
    const replySpy = replyModule.__replySpy as unknown as ReturnType<typeof vi.fn>;
    replySpy.mockReset();
    replySpy.mockImplementation(async (_ctx, opts) => {
      await opts?.onToolResult?.({ text: "tool update" });
      return { text: "final reply" };
    });

    loadConfig.mockReturnValue({
      commands: { native: true },
      channels: {
        telegram: {
          dmPolicy: "open",
          allowFrom: ["*"],
        },
      },
    });

    createTelegramBot({ token: "tok" });
    const verboseHandler = spies.commandSpy.mock.calls.find((call) => call[0] === "verbose")?.[1] as
      | ((ctx: Record<string, unknown>) => Promise<void>)
      | undefined;
    if (!verboseHandler) {
      throw new Error("verbose command handler missing");
    }

    await verboseHandler({
      message: {
        chat: { id: 12345, type: "private" },
        from: { id: 12345, username: "testuser" },
        text: "/verbose on",
        date: 1736380800,
        message_id: 42,
      },
      match: "on",
    });

    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    expect(sendMessageSpy.mock.calls[0]?.[1]).toContain("final reply");
  });
});
