/**
 * dispatch-from-config.async.test.ts
 * Tests for async dispatch mode (fire-and-forget agent turn execution)
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { VersoConfig } from "../../config/config.js";
import type { FinalizedMsgContext } from "../templating.js";
import type { ReplyDispatcher } from "./reply-dispatcher.js";
import { dispatchReplyFromConfig } from "./dispatch-from-config.js";

// Mock the dependencies
vi.mock("../../agents/pi-embedded-runner/runs.js", () => ({
  isEmbeddedPiRunActive: vi.fn(),
  isDispatchPending: vi.fn(),
  markDispatchPending: vi.fn(),
  clearDispatchPending: vi.fn(),
  queueEmbeddedPiMessage: vi.fn(),
  queuePendingMessage: vi.fn(),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveSessionAgentId: vi.fn(() => "test-agent"),
}));

vi.mock("../../config/sessions.js", () => ({
  loadSessionStore: vi.fn(() => ({})),
  resolveStorePath: vi.fn(() => "/tmp/store"),
}));

vi.mock("../../infra/diagnostic-events.js", () => ({
  isDiagnosticsEnabled: vi.fn(() => false),
}));

vi.mock("../../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: vi.fn(() => null),
}));

vi.mock("../reply.js", () => ({
  getReplyFromConfig: vi.fn(async () => ({ text: "Test reply" })),
}));

vi.mock("./abort.js", () => ({
  tryFastAbortFromMessage: vi.fn(async () => ({ handled: false })),
  formatAbortReplyText: vi.fn(() => "Aborted"),
}));

vi.mock("./inbound-dedupe.js", () => ({
  shouldSkipDuplicateInbound: vi.fn(() => false),
}));

vi.mock("./route-reply.js", () => ({
  isRoutableChannel: vi.fn(() => false),
  routeReply: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../tts/tts.js", () => ({
  maybeApplyTtsToPayload: vi.fn(async (opts) => opts.payload),
  normalizeTtsAutoMode: vi.fn(() => undefined),
  resolveTtsConfig: vi.fn(() => ({ mode: "final" })),
}));

describe("dispatchReplyFromConfig - async dispatch mode", () => {
  let mockDispatcher: ReplyDispatcher;
  let mockCtx: FinalizedMsgContext;
  let mockConfig: VersoConfig;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock dispatcher
    mockDispatcher = {
      sendFinalReply: vi.fn(() => true),
      sendToolResult: vi.fn(),
      sendBlockReply: vi.fn(),
      waitForIdle: vi.fn(async () => {}),
      getQueuedCounts: vi.fn(() => ({
        final: 0,
        tool: 0,
        block: 0,
      })),
    } as unknown as ReplyDispatcher;

    // Create mock context
    mockCtx = {
      SessionKey: "test-session",
      Body: "Hello",
      Provider: "telegram",
      From: "user123",
      To: "bot",
      ChatType: "direct",
      CommandSource: "user",
    } as FinalizedMsgContext;

    // Create mock config
    mockConfig = {
      agents: {
        defaults: {
          asyncDispatch: false, // Default sync mode
        },
      },
    } as VersoConfig;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should use sync mode when asyncDispatch is false", async () => {
    const { isEmbeddedPiRunActive } = await import("../../agents/pi-embedded-runner/runs.js");
    const { getReplyFromConfig } = await import("../reply.js");

    const result = await dispatchReplyFromConfig({
      ctx: mockCtx,
      cfg: mockConfig,
      dispatcher: mockDispatcher,
    });

    // Should not check for active run in sync mode
    expect(isEmbeddedPiRunActive).not.toHaveBeenCalled();

    // Should await getReplyFromConfig
    expect(getReplyFromConfig).toHaveBeenCalledTimes(1);

    // Should queue final reply
    expect(mockDispatcher.sendFinalReply).toHaveBeenCalledWith({ text: "Test reply" });

    expect(result.queuedFinal).toBe(true);
  });

  it("should steer message to active run in async mode", async () => {
    const { isEmbeddedPiRunActive, queueEmbeddedPiMessage } =
      await import("../../agents/pi-embedded-runner/runs.js");
    const { getReplyFromConfig } = await import("../reply.js");

    // Enable async mode
    mockConfig.agents!.defaults!.asyncDispatch = true;

    // Mock active run
    vi.mocked(isEmbeddedPiRunActive).mockReturnValue(true);
    vi.mocked(queueEmbeddedPiMessage).mockReturnValue(true);

    const result = await dispatchReplyFromConfig({
      ctx: mockCtx,
      cfg: mockConfig,
      dispatcher: mockDispatcher,
    });

    // Should check for active run
    expect(isEmbeddedPiRunActive).toHaveBeenCalledWith("test-session");

    // Should try to steer message
    expect(queueEmbeddedPiMessage).toHaveBeenCalledWith("test-session", "Hello");

    // Should NOT call getReplyFromConfig (steered)
    expect(getReplyFromConfig).not.toHaveBeenCalled();

    // Should NOT queue final reply
    expect(mockDispatcher.sendFinalReply).not.toHaveBeenCalled();

    expect(result.queuedFinal).toBe(false);
  });

  it("should fire-and-forget new agent turn in async mode when no active run", async () => {
    const { isEmbeddedPiRunActive, isDispatchPending, markDispatchPending } =
      await import("../../agents/pi-embedded-runner/runs.js");

    // Enable async mode
    mockConfig.agents!.defaults!.asyncDispatch = true;

    // Mock no active run, no pending dispatch
    vi.mocked(isEmbeddedPiRunActive).mockReturnValue(false);
    vi.mocked(isDispatchPending).mockReturnValue(false);

    const result = await dispatchReplyFromConfig({
      ctx: mockCtx,
      cfg: mockConfig,
      dispatcher: mockDispatcher,
    });

    // Should check for active run
    expect(isEmbeddedPiRunActive).toHaveBeenCalledWith("test-session");

    // Should mark pending before fire-and-forget
    expect(markDispatchPending).toHaveBeenCalledWith("test-session");

    // Should return immediately without queueing final reply
    expect(result.queuedFinal).toBe(false);

    // Allow background task to run (if any)
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it("should buffer message when dispatch is pending", async () => {
    const { isEmbeddedPiRunActive, isDispatchPending, queuePendingMessage } =
      await import("../../agents/pi-embedded-runner/runs.js");
    const { getReplyFromConfig } = await import("../reply.js");

    // Enable async mode
    mockConfig.agents!.defaults!.asyncDispatch = true;

    // No active run, but dispatch is pending (turn fired but not yet registered)
    vi.mocked(isEmbeddedPiRunActive).mockReturnValue(false);
    vi.mocked(isDispatchPending).mockReturnValue(true);
    vi.mocked(queuePendingMessage).mockReturnValue(true); // Buffered

    const result = await dispatchReplyFromConfig({
      ctx: mockCtx,
      cfg: mockConfig,
      dispatcher: mockDispatcher,
    });

    // Should buffer into pending dispatch
    expect(queuePendingMessage).toHaveBeenCalledWith("test-session", "Hello");

    // Should NOT start a new agent turn
    expect(getReplyFromConfig).not.toHaveBeenCalled();

    expect(result.queuedFinal).toBe(false);
  });

  it("should fall through to new run when steering fails in async mode", async () => {
    const { isEmbeddedPiRunActive, isDispatchPending, queueEmbeddedPiMessage } =
      await import("../../agents/pi-embedded-runner/runs.js");

    // Enable async mode
    mockConfig.agents!.defaults!.asyncDispatch = true;

    // Mock active run but steering fails
    vi.mocked(isEmbeddedPiRunActive).mockReturnValue(true);
    vi.mocked(isDispatchPending).mockReturnValue(false);
    vi.mocked(queueEmbeddedPiMessage).mockReturnValue(false); // Steering failed

    const result = await dispatchReplyFromConfig({
      ctx: mockCtx,
      cfg: mockConfig,
      dispatcher: mockDispatcher,
    });

    // Should try to steer
    expect(queueEmbeddedPiMessage).toHaveBeenCalledWith("test-session", "Hello");

    // Should fall through to fire-and-forget
    expect(result.queuedFinal).toBe(false);
  });
});
