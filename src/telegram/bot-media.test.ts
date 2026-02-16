import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetInboundDedupe } from "../auto-reply/reply/inbound-dedupe.js";
import { createBotTestSpies, makeGetOnHandler } from "./bot-test-helpers.js";
import { createTelegramBot } from "./bot.js";

const spies = createBotTestSpies();
const {
  middlewareUseSpy,
  onSpy,
  botCtorSpy,
  sendAnimationSpy,
  sendPhotoSpy,
  setMyCommandsSpy,
  apiStub,
} = spies;

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
  sessionStorePath: `/tmp/verso-telegram-bot-media-${Math.random().toString(16).slice(2)}.json`,
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
  const replySpy = vi.fn(async (_ctx: unknown, opts?: { onReplyStart?: () => Promise<void> }) => {
    await opts?.onReplyStart?.();
    return undefined;
  });
  return { getReplyFromConfig: replySpy, __replySpy: replySpy };
});

const getOnHandler = makeGetOnHandler(onSpy);
const ORIGINAL_TZ = process.env.TZ;

describe("createTelegramBot – media", () => {
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
    sendAnimationSpy.mockReset();
    sendPhotoSpy.mockReset();
    setMyCommandsSpy.mockReset();
    wasSentByBot.mockReset();
    middlewareUseSpy.mockReset();
    botCtorSpy.mockReset();
  });

  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it("sends GIF replies as animations", async () => {
    onSpy.mockReset();
    const replySpy = replyModule.__replySpy as unknown as ReturnType<typeof vi.fn>;
    replySpy.mockReset();

    replySpy.mockResolvedValueOnce({
      text: "caption",
      mediaUrl: "https://example.com/fun",
    });

    loadWebMedia.mockResolvedValueOnce({
      buffer: Buffer.from("GIF89a"),
      contentType: "image/gif",
      fileName: "fun.gif",
    });

    createTelegramBot({ token: "tok" });
    const handler = getOnHandler("message") as (ctx: Record<string, unknown>) => Promise<void>;

    await handler({
      message: {
        chat: { id: 1234, type: "private" },
        text: "hello world",
        date: 1736380800,
        message_id: 5,
        from: { first_name: "Ada" },
      },
      me: { username: "verso_bot" },
      getFile: async () => ({ download: async () => new Uint8Array() }),
    });

    expect(sendAnimationSpy).toHaveBeenCalledTimes(1);
    expect(sendAnimationSpy).toHaveBeenCalledWith("1234", expect.anything(), {
      caption: "caption",
      parse_mode: "HTML",
      reply_to_message_id: undefined,
    });
    expect(sendPhotoSpy).not.toHaveBeenCalled();
  });
});
