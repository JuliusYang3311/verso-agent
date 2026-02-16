import { describe, expect, it, vi } from "vitest";
import type { VersoConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import type { SessionsPatchParams } from "./protocol/index.js";
import { applySessionsPatchToStore } from "./sessions-patch.js";

describe("sessions-patch auth profile preservation", () => {
  const mockConfig = {
    agents: {
      defaults: {
        model: { primary: "provider/model" },
      },
    },
  } as unknown as VersoConfig;

  const mockCatalogLoader = vi.fn().mockResolvedValue([
    {
      id: "new-model",
      provider: "new-provider",
    },
  ]);

  it("clears authProfileOverride when patching model without explicit auth", async () => {
    const store: Record<string, SessionEntry> = {
      "agent:main:s1": {
        sessionId: "s1",
        updatedAt: 100,
        providerOverride: "old-p",
        modelOverride: "old-m",
        authProfileOverride: "auth-123",
        authProfileOverrideSource: "user",
      },
    };

    const result = await applySessionsPatchToStore({
      cfg: mockConfig,
      store,
      storeKey: "agent:main:s1",
      patch: {
        key: "agent:main:s1",
        model: "new-model",
      },
      loadGatewayModelCatalog: mockCatalogLoader,
    });

    if (!result.ok) {
      throw new Error(`patch failed: ${JSON.stringify(result.error)}`);
    }

    expect(result.entry.modelOverride).toBe("new-model");
    // When model changes without explicit auth override in the patch,
    // the old auth profile is cleared so it can be re-resolved for the new provider.
    expect(result.entry.authProfileOverride).toBeUndefined();
    expect(result.entry.authProfileOverrideSource).toBeUndefined();
  });

  it("updates authProfileOverride when provided in patch", async () => {
    const store: Record<string, SessionEntry> = {
      "agent:main:s2": {
        sessionId: "s2",
        updatedAt: 100,
      },
    };

    const result = await applySessionsPatchToStore({
      cfg: mockConfig,
      store,
      storeKey: "agent:main:s2",
      patch: {
        key: "agent:main:s2",
        authProfileId: "new-auth-profile",
      } as unknown as SessionsPatchParams, // Cast because type definition might be lagging in test file context
      loadGatewayModelCatalog: mockCatalogLoader,
    });

    if (!result.ok) {
      throw new Error(`patch failed: ${JSON.stringify(result.error)}`);
    }

    expect(result.entry.authProfileOverride).toBe("new-auth-profile");
    expect(result.entry.authProfileOverrideSource).toBe("user");
  });
});
