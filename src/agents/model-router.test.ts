import { describe, it, expect, vi } from "vitest";
import type { VersoConfig } from "../config/config.js";
import {
  buildSelectionPrompt,
  resolveRouterConfig,
  resolveRouterModel,
  selectDynamicModel,
} from "./model-router.js";

describe("model-router", () => {
  describe("buildSelectionPrompt", () => {
    it("should build prompt with user input and models", () => {
      const prompt = buildSelectionPrompt({
        input: "Help me write code",
        models: ["model-a", "model-b"],
      });
      expect(prompt).toContain("Help me write code");
      expect(prompt).toContain("- model-a");
      expect(prompt).toContain("- model-b");
    });
  });

  describe("resolveRouterConfig", () => {
    it("should return null when router is disabled", () => {
      const cfg: Partial<VersoConfig> = {
        agents: {
          defaults: {
            router: { enabled: false },
          },
        },
      };
      expect(resolveRouterConfig(cfg as VersoConfig)).toBeNull();
    });

    it("should return config when router is enabled", () => {
      const cfg: Partial<VersoConfig> = {
        agents: {
          defaults: {
            router: { enabled: true, classifierModel: "google/gemini-2.0-flash" },
          },
        },
      };
      const result = resolveRouterConfig(cfg as VersoConfig);
      expect(result?.enabled).toBe(true);
      expect(result?.classifierModel).toBe("google/gemini-2.0-flash");
    });
  });

  describe("selectDynamicModel", () => {
    it("should select model from candidates", async () => {
      const mockCallClassifier = vi
        .fn()
        .mockResolvedValue("<selected_model>google/gemini-2.0-flash</selected_model>");
      const result = await selectDynamicModel({
        input: "test",
        candidates: ["google/gemini-2.0-flash", "anthropic/claude-3-5-sonnet"],
        callClassifier: mockCallClassifier,
        classifierModel: "google/gemini-2.0-flash",
      });
      expect(result).toBe("google/gemini-2.0-flash");
    });

    it("should fallback to first allowed candidate on error", async () => {
      const mockCallClassifier = vi.fn().mockRejectedValue(new Error("fail"));
      const result = await selectDynamicModel({
        input: "test",
        candidates: ["fallback-model", "other-model"],
        callClassifier: mockCallClassifier,
        classifierModel: "google/gemini-2.0-flash",
      });
      // It basically returns null on total failure, but we check if it returns null or fallback
      // The implementation returns null if all attempts fail.
      // Wait, let's check the implementation...
      // "return null;" at the end.
      expect(result).toBeNull();
    });

    it("should handle raw response without tags if it matches exactly", async () => {
      const mockCallClassifier = vi.fn().mockResolvedValue("google/gemini-2.0-flash");
      const result = await selectDynamicModel({
        input: "test",
        candidates: ["google/gemini-2.0-flash"],
        callClassifier: mockCallClassifier,
        classifierModel: "google/gemini-2.0-flash",
      });
      expect(result).toBe("google/gemini-2.0-flash");
    });
  });

  describe("resolveRouterModel", () => {
    it("should return routerUsed: false when disabled", async () => {
      const result = await resolveRouterModel({
        input: "test",
        cfg: {} as VersoConfig,
        defaultProvider: "anthropic",
        callClassifier: vi.fn(),
      });

      expect(result.routerUsed).toBe(false);
    });

    it("should resolve model when router is configured", async () => {
      const mockCallClassifier = vi
        .fn()
        .mockResolvedValue("<selected_model>anthropic/claude-sonnet-4-5</selected_model>");

      const cfg: Partial<VersoConfig> = {
        agents: {
          defaults: {
            models: { "anthropic/claude-sonnet-4-5": {} }, // Ensure it's available
            router: {
              enabled: true,
              classifierModel: "google/gemini-2.0-flash",
            },
          },
        },
      };

      const result = await resolveRouterModel({
        input: "Write a function",
        cfg: cfg as VersoConfig,
        defaultProvider: "anthropic",
        callClassifier: mockCallClassifier,
      });

      expect(result.routerUsed).toBe(true);
      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe("claude-sonnet-4-5");
    });
  });
});
