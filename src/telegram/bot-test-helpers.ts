/**
 * Shared test helpers for bot.test.ts decomposition.
 *
 * NOTE: vi.mock() calls MUST remain in each individual test file because
 * vitest requires them to be hoisted at the module level of the test file.
 * This module only exports non-mock helpers (spy factories, context builders, etc.).
 */
import { vi } from "vitest";

// ── Spy factories ──────────────────────────────────────────────────────────
// Each test file calls createBotTestSpies() in its own scope so the spies
// are fresh and independent.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createBotTestSpies(): Record<string, any> {
  const useSpy = vi.fn();
  const middlewareUseSpy = vi.fn();
  const onSpy = vi.fn();
  const stopSpy = vi.fn();
  const commandSpy = vi.fn();
  const botCtorSpy = vi.fn();
  const answerCallbackQuerySpy = vi.fn(async () => undefined);
  const sendChatActionSpy = vi.fn();
  const editMessageTextSpy = vi.fn(async () => ({ message_id: 88 }));
  const setMessageReactionSpy = vi.fn(async () => undefined);
  const setMyCommandsSpy = vi.fn(async () => undefined);
  const sendMessageSpy = vi.fn(async () => ({ message_id: 77 }));
  const sendAnimationSpy = vi.fn(async () => ({ message_id: 78 }));
  const sendPhotoSpy = vi.fn(async () => ({ message_id: 79 }));

  type ApiStub = {
    config: { use: (arg: unknown) => void };
    answerCallbackQuery: typeof answerCallbackQuerySpy;
    sendChatAction: typeof sendChatActionSpy;
    editMessageText: typeof editMessageTextSpy;
    setMessageReaction: typeof setMessageReactionSpy;
    setMyCommands: typeof setMyCommandsSpy;
    sendMessage: typeof sendMessageSpy;
    sendAnimation: typeof sendAnimationSpy;
    sendPhoto: typeof sendPhotoSpy;
  };

  const apiStub: ApiStub = {
    config: { use: useSpy },
    answerCallbackQuery: answerCallbackQuerySpy,
    sendChatAction: sendChatActionSpy,
    editMessageText: editMessageTextSpy,
    setMessageReaction: setMessageReactionSpy,
    setMyCommands: setMyCommandsSpy,
    sendMessage: sendMessageSpy,
    sendAnimation: sendAnimationSpy,
    sendPhoto: sendPhotoSpy,
  };

  return {
    useSpy,
    middlewareUseSpy,
    onSpy,
    stopSpy,
    commandSpy,
    botCtorSpy,
    answerCallbackQuerySpy,
    sendChatActionSpy,
    editMessageTextSpy,
    setMessageReactionSpy,
    setMyCommandsSpy,
    sendMessageSpy,
    sendAnimationSpy,
    sendPhotoSpy,
    apiStub,
  };
}

// ── Handler lookup ─────────────────────────────────────────────────────────

export function makeGetOnHandler(onSpy: ReturnType<typeof vi.fn>) {
  return (event: string) => {
    const handler = onSpy.mock.calls.find((call) => call[0] === event)?.[1];
    if (!handler) {
      throw new Error(`Missing handler for event: ${event}`);
    }
    return handler as (ctx: Record<string, unknown>) => Promise<void>;
  };
}
