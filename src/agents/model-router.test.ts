import { describe, it, expect, vi } from "vitest";
import {
  buildClassificationPrompt,
  parseClassificationResponse,
  getValidTaskTypes,
  resolveRouterConfig,
  resolveModelForTask,
  classifyTask,
  resolveRouterModel,
  selectDynamicModel,
} from "./model-router.js";
import type { VersoConfig } from "../config/config.js";
import type { RouterConfig } from "../config/types.router.js";

describe("model-router", () => {
  describe("buildClassificationPrompt", () => {
    it("should build prompt with user input", () => {
      const prompt = buildClassificationPrompt("Help me write code");
      expect(prompt).toContain("Help me write code");
      expect(prompt).toContain("Categories:");
    });

    it("should use custom prompt template", () => {
      const customPrompt = "Classify this: {input}";
      const prompt = buildClassificationPrompt("test input", customPrompt);
      expect(prompt).toBe("Classify this: test input");
    });
  });

  describe("parseClassificationResponse", () => {
    const validTypes = new Set(["coding", "writing", "analysis", "chat"]);

    it("should parse single word response", () => {
      expect(parseClassificationResponse("coding", validTypes, "chat")).toBe("coding");
    });

    it("should parse response with extra text", () => {
      expect(parseClassificationResponse("The task is coding related", validTypes, "chat")).toBe(
        "coding",
      );
    });

    it("should be case insensitive", () => {
      expect(parseClassificationResponse("CODING", validTypes, "chat")).toBe("coding");
    });

    it("should return default for unknown response", () => {
      expect(parseClassificationResponse("unknown", validTypes, "chat")).toBe("chat");
    });
  });

  describe("getValidTaskTypes", () => {
    it("should return default types", () => {
      const types = getValidTaskTypes({});
      expect(types.has("coding")).toBe(true);
      expect(types.has("writing")).toBe(true);
      expect(types.has("chat")).toBe(true);
    });

    it("should include custom task types from config", () => {
      const config: RouterConfig = {
        taskModels: {
          custom: "provider/model",
        },
      };
      const types = getValidTaskTypes(config);
      expect(types.has("custom")).toBe(true);
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

  describe("resolveModelForTask", () => {
    const routerConfig: RouterConfig = {
      enabled: true,
      taskModels: {
        coding: "anthropic/claude-sonnet-4-5",
        writing: "google/gemini-2.5-pro",
      },
      defaultTask: "chat",
    };

    it("should resolve model for configured task", () => {
      const ref = resolveModelForTask("coding", routerConfig, "anthropic");
      expect(ref?.provider).toBe("anthropic");
      expect(ref?.model).toBe("claude-sonnet-4-5");
    });

    it("should return null for unconfigured task with no default", () => {
      const config: RouterConfig = {
        enabled: true,
        taskModels: {
          coding: "anthropic/claude-sonnet-4-5",
        },
      };
      const ref = resolveModelForTask("analysis", config, "anthropic");
      expect(ref).toBeNull();
    });

    it("should return null when no taskModels configured", () => {
      const config: RouterConfig = { enabled: true };
      const ref = resolveModelForTask("coding", config, "anthropic");
      expect(ref).toBeNull();
    });
  });

  describe("classifyTask", () => {
    it("should classify task successfully", async () => {
      const mockCallClassifier = vi.fn().mockResolvedValue("coding");
      const result = await classifyTask({
        input: "Write a function to sort an array",
        routerConfig: {
          enabled: true,
          classifierModel: "google/gemini-2.0-flash",
        },
        callClassifier: mockCallClassifier,
      });

      expect("taskType" in result).toBe(true);
      if ("taskType" in result) {
        expect(result.taskType).toBe("coding");
        expect(result.timeMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("should return error when no classifier model", async () => {
      const mockCallClassifier = vi.fn();
      const result = await classifyTask({
        input: "test",
        routerConfig: { enabled: true },
        callClassifier: mockCallClassifier,
      });

      expect("error" in result).toBe(true);
    });

    it("should handle classifier errors", async () => {
      const mockCallClassifier = vi.fn().mockRejectedValue(new Error("API error"));
      const result = await classifyTask({
        input: "test",
        routerConfig: {
          enabled: true,
          classifierModel: "google/gemini-2.0-flash",
        },
        callClassifier: mockCallClassifier,
      });

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("Classification failed");
      }
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
        .mockResolvedValueOnce("coding") // Classification
        .mockResolvedValueOnce("anthropic/claude-sonnet-4-5"); // Dynamic Selection

      const cfg: Partial<VersoConfig> = {
        agents: {
          defaults: {
            models: { "anthropic/claude-sonnet-4-5": {} }, // Ensure it's available
            router: {
              enabled: true,
              classifierModel: "google/gemini-2.0-flash",
              taskModels: {
                coding: "legacy/static-model", // Should be IGNORED
              },
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
      expect(result.taskType).toBe("coding");
      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe("claude-sonnet-4-5");
    });
  });
});

describe("selectDynamicModel", () => {
  it("should select model from candidates", async () => {
    const mockCallClassifier = vi.fn().mockResolvedValue("google/gemini-2.0-flash");
    const result = await selectDynamicModel({
      input: "test",
      taskType: "chat",
      candidates: ["google/gemini-2.0-flash", "anthropic/claude-3-5-sonnet"],
      callClassifier: mockCallClassifier,
      classifierModel: "google/gemini-2.0-flash",
    });
    expect(result).toBe("google/gemini-2.0-flash");
  });

  it("should fallback to first candidate on error", async () => {
    const mockCallClassifier = vi.fn().mockRejectedValue(new Error("fail"));
    const result = await selectDynamicModel({
      input: "test",
      taskType: "chat",
      candidates: ["fallback-model", "other-model"],
      callClassifier: mockCallClassifier,
      classifierModel: "google/gemini-2.0-flash",
    });
    expect(result).toBe("fallback-model");
  });
});

describe("resolveRouterModel dynamic & exclusion", () => {
  it("should fallback to dynamic selection if static mapping matches excluded model", async () => {
    const mockCallClassifier = vi.fn().mockImplementation(async ({ prompt }) => {
      if (prompt.includes("Categories:")) return "coding";
      if (prompt.includes("Available Models:")) return "google/gemini-pro";
      return "";
    });

    const cfg: Partial<VersoConfig> = {
      agents: {
        defaults: {
          models: {
            "google/gemini-pro": {},
            "anthropic/claude-sonnet": {},
          },
          router: {
            enabled: true,
            classifierModel: "google/gemini-flash",
            taskModels: {
              coding: "anthropic/claude-sonnet",
            },
          },
        },
      },
    };

    const result = await resolveRouterModel({
      input: "Code something",
      cfg: cfg as VersoConfig,
      defaultProvider: "google",
      callClassifier: mockCallClassifier,
      excludeModels: ["anthropic/claude-sonnet"],
    });

    expect(result.routerUsed).toBe(true);
    expect(result.taskType).toBe("coding");
    // Static was excluded, so it should pick dynamic "google/gemini-pro"
    expect(result.model).toBe("gemini-pro");
  });
});
