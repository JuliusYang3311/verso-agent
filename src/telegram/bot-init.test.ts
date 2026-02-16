import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listNativeCommandSpecs,
  listNativeCommandSpecsForConfig,
} from "../auto-reply/commands-registry.js";
import { resetInboundDedupe } from "../auto-reply/reply/inbound-dedupe.js";
import { createBotTestSpies } from "./bot-test-helpers.js";
import { createTelegramBot, getTelegramSequentialKey } from "./bot.js";
import { resolveTelegramFetch } from "./fetch.js";

const spies = createBotTestSpies();
const { useSpy, middlewareUseSpy, onSpy, botCtorSpy, setMyCommandsSpy, apiStub } = spies;

let sequentializeKey: ((ctx: unknown) => string) | undefined;

const { listSkillCommandsForAgents } = vi.hoisted(() => ({
  listSkillCommandsForAgents: vi.fn(() => []),
}));
vi.mock("../auto-reply/skill-commands.js", () => ({
  listSkillCommandsForAgents,
}));

function resolveSkillCommands(config: Parameters<typeof listNativeCommandSpecsForConfig>[0]) {
  return listSkillCommandsForAgents({ cfg: config });
}

const { loadWebMedia } = vi.hoisted(() => ({
  loadWebMedia: vi.fn(),
}));
vi.mock("../web/media.js", () => ({
  loadWebMedia,
}));

const { loadConfig } = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({})),
}));
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return { ...actual, loadConfig };
});

const { sessionStorePath } = vi.hoisted(() => ({
  sessionStorePath: `/tmp/verso-telegram-bot-init-${Math.random().toString(16).slice(2)}.json`,
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

const { enqueueSystemEvent } = vi.hoisted(() => ({
  enqueueSystemEvent: vi.fn(),
}));
vi.mock("../infra/system-events.js", () => ({ enqueueSystemEvent }));

const { wasSentByBot } = vi.hoisted(() => ({
  wasSentByBot: vi.fn(() => false),
}));
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

const sequentializeSpy = vi.fn();
vi.mock("@grammyjs/runner", () => ({
  sequentialize: (keyFn: (ctx: unknown) => string) => {
    sequentializeKey = keyFn;
    return sequentializeSpy();
  },
}));

const throttlerSpy = vi.fn(() => "throttler");
vi.mock("@grammyjs/transformer-throttler", () => ({
  apiThrottler: () => throttlerSpy(),
}));

vi.mock("../auto-reply/reply.js", () => {
  const replySpy = vi.fn(async (_ctx: unknown, opts?: { onReplyStart?: () => Promise<void> }) => {
    await opts?.onReplyStart?.();
    return undefined;
  });
  return { getReplyFromConfig: replySpy, __replySpy: replySpy };
});

const ORIGINAL_TZ = process.env.TZ;

describe("createTelegramBot – init", () => {
  beforeAll(async () => {
    await import("../auto-reply/reply.js");
  });

  beforeEach(() => {
    process.env.TZ = "UTC";
    resetInboundDedupe();
    loadConfig.mockReturnValue({
      agents: { defaults: { envelopeTimezone: "utc" } },
      channels: { telegram: { dmPolicy: "open", allowFrom: ["*"] } },
    });
    loadWebMedia.mockReset();
    setMyCommandsSpy.mockReset();
    wasSentByBot.mockReset();
    middlewareUseSpy.mockReset();
    sequentializeSpy.mockReset();
    botCtorSpy.mockReset();
    sequentializeKey = undefined;
  });

  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it("installs grammY throttler", () => {
    createTelegramBot({ token: "tok" });
    expect(throttlerSpy).toHaveBeenCalledTimes(1);
    expect(useSpy).toHaveBeenCalledWith("throttler");
  });

  it("merges custom commands with native commands", () => {
    const config = {
      channels: {
        telegram: {
          customCommands: [
            { command: "custom_backup", description: "Git backup" },
            { command: "/Custom_Generate", description: "Create an image" },
          ],
        },
      },
    };
    loadConfig.mockReturnValue(config);

    createTelegramBot({ token: "tok" });

    const registered = setMyCommandsSpy.mock.calls[0]?.[0] as Array<{
      command: string;
      description: string;
    }>;
    const skillCommands = resolveSkillCommands(config);
    const native = listNativeCommandSpecsForConfig(config, { skillCommands }).map((command) => ({
      command: command.name,
      description: command.description,
    }));
    expect(registered.slice(0, native.length)).toEqual(native);
    expect(registered.slice(native.length)).toEqual([
      { command: "custom_backup", description: "Git backup" },
      { command: "custom_generate", description: "Create an image" },
    ]);
  });

  it("ignores custom commands that collide with native commands", () => {
    const errorSpy = vi.fn();
    const config = {
      channels: {
        telegram: {
          customCommands: [
            { command: "status", description: "Custom status" },
            { command: "custom_backup", description: "Git backup" },
          ],
        },
      },
    };
    loadConfig.mockReturnValue(config);

    createTelegramBot({
      token: "tok",
      runtime: {
        log: vi.fn(),
        error: errorSpy,
        exit: ((code: number) => {
          throw new Error(`exit ${code}`);
        }) as (code: number) => never,
      },
    });

    const registered = setMyCommandsSpy.mock.calls[0]?.[0] as Array<{
      command: string;
      description: string;
    }>;
    const skillCommands = resolveSkillCommands(config);
    const native = listNativeCommandSpecsForConfig(config, { skillCommands }).map((command) => ({
      command: command.name,
      description: command.description,
    }));
    const nativeStatus = native.find((command) => command.command === "status");
    expect(nativeStatus).toBeDefined();
    expect(registered).toContainEqual({ command: "custom_backup", description: "Git backup" });
    expect(registered).not.toContainEqual({ command: "status", description: "Custom status" });
    expect(registered.filter((command) => command.command === "status")).toEqual([nativeStatus]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("registers custom commands when native commands are disabled", () => {
    const config = {
      commands: { native: false },
      channels: {
        telegram: {
          customCommands: [
            { command: "custom_backup", description: "Git backup" },
            { command: "custom_generate", description: "Create an image" },
          ],
        },
      },
    };
    loadConfig.mockReturnValue(config);

    createTelegramBot({ token: "tok" });

    const registered = setMyCommandsSpy.mock.calls[0]?.[0] as Array<{
      command: string;
      description: string;
    }>;
    expect(registered).toEqual([
      { command: "custom_backup", description: "Git backup" },
      { command: "custom_generate", description: "Create an image" },
    ]);
    const reserved = new Set(listNativeCommandSpecs().map((command) => command.name));
    expect(registered.some((command) => reserved.has(command.command))).toBe(false);
  });

  it("uses wrapped fetch when global fetch is available", () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn() as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    try {
      createTelegramBot({ token: "tok" });
      const fetchImpl = resolveTelegramFetch();
      expect(fetchImpl).toBeTypeOf("function");
      expect(fetchImpl).not.toBe(fetchSpy);
      const clientFetch = (botCtorSpy.mock.calls[0]?.[1] as { client?: { fetch?: unknown } })
        ?.client?.fetch;
      expect(clientFetch).toBeTypeOf("function");
      expect(clientFetch).not.toBe(fetchSpy);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sequentializes updates by chat and thread", () => {
    createTelegramBot({ token: "tok" });
    expect(sequentializeSpy).toHaveBeenCalledTimes(1);
    expect(middlewareUseSpy).toHaveBeenCalledWith(sequentializeSpy.mock.results[0]?.value);
    expect(sequentializeKey).toBe(getTelegramSequentialKey);
    expect(getTelegramSequentialKey({ message: { chat: { id: 123 } } })).toBe("telegram:123");
    expect(
      getTelegramSequentialKey({
        message: { chat: { id: 123, type: "private" }, message_thread_id: 9 },
      }),
    ).toBe("telegram:123:topic:9");
    expect(
      getTelegramSequentialKey({
        message: { chat: { id: 123, type: "supergroup" }, message_thread_id: 9 },
      }),
    ).toBe("telegram:123");
    expect(
      getTelegramSequentialKey({
        message: { chat: { id: 123, type: "supergroup", is_forum: true } },
      }),
    ).toBe("telegram:123:topic:1");
    expect(
      getTelegramSequentialKey({
        update: { message: { chat: { id: 555 } } },
      }),
    ).toBe("telegram:555");
  });

  it("clears native commands when disabled", () => {
    loadConfig.mockReturnValue({
      commands: { native: false },
    });

    createTelegramBot({ token: "tok" });

    expect(setMyCommandsSpy).toHaveBeenCalledWith([]);
  });
});
