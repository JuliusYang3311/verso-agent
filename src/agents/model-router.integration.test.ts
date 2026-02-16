import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VersoConfig } from "../config/config.js";
import { createClassifierFn } from "./model-router-classifier.js";

// Mock @mariozechner/pi-ai
const mockCompleteSimple = vi.fn();
vi.mock("@mariozechner/pi-ai", async () => {
  const actual = await vi.importActual("@mariozechner/pi-ai");
  return {
    ...actual,
    completeSimple: (...args: unknown[]) => mockCompleteSimple(...args),
    getModel: vi.fn().mockImplementation((p, m) => ({ id: m, provider: p, name: m })),
  };
});

// Mock model-auth to avoid auth errors
vi.mock("./model-auth.js", () => ({
  resolveApiKeyForProvider: vi.fn().mockResolvedValue({ apiKey: "test-key", mode: "api-key" }),
}));

describe("Smart Router Integration with Caching & Metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Since decisionCache is module-level, we can't easily clear it without exposing a clear function
    // or reloading the module. For this test, valid keys will be unique per test if needed.
  });

  it("should cache classifier decisions for identical prompts", async () => {
    const cfg: VersoConfig = { agents: { defaults: { router: { enabled: true } } } };
    const classifier = createClassifierFn(cfg);

    // Setup mock response
    mockCompleteSimple.mockResolvedValue({ content: "coding" });

    const params = {
      provider: "google",
      model: "gemini-2.0-flash",
      prompt: "Write a python script unique1",
      timeoutMs: 1000,
    };

    // First call - should hit API
    const result1 = await classifier(params);
    expect(result1).toBe("coding");
    expect(mockCompleteSimple).toHaveBeenCalledTimes(1);

    // Second call - SAME prompt - should valid cache and NOT hit API
    const result2 = await classifier(params);
    expect(result2).toBe("coding");
    expect(mockCompleteSimple).toHaveBeenCalledTimes(1); // Call count should remain 1
  });

  it("should make new API call for different prompts", async () => {
    const cfg: VersoConfig = { agents: { defaults: { router: { enabled: true } } } };
    const classifier = createClassifierFn(cfg);

    mockCompleteSimple.mockResolvedValue({ content: "chat" });

    // Call 1
    await classifier({
      provider: "google",
      model: "gemini-2.0-flash",
      prompt: "Hello A unique2",
      timeoutMs: 1000,
    });

    // Call 2
    await classifier({
      provider: "google",
      model: "gemini-2.0-flash",
      prompt: "Hello B unique3",
      timeoutMs: 1000,
    });

    // Should have called API twice (plus previous test calls if mock wasn't cleared, but beforeEach clears mock stats)
    // Wait, beforeEach clears *mocks*, but the *decisionCache* variable inside the module persists across tests in same file run!
    // That is why unique prompts are important.
    expect(mockCompleteSimple).toHaveBeenCalledTimes(2);
  });
});
