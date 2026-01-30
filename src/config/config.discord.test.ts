import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "./test-helpers.js";

describe("config discord", () => {
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.HOME;
  });

  afterEach(() => {
    process.env.HOME = previousHome;
  });

  it("loads discord guild map + dm group settings", async () => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".verso");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "verso.json"),
        JSON.stringify(
          {
            channels: {
              discord: {
                enabled: true,
                dm: {
                  enabled: true,
                  allowFrom: ["steipete"],
                  groupEnabled: true,
                  groupChannels: ["verso-dm"],
                },
                actions: {
                  emojiUploads: true,
                  stickerUploads: false,
                  channels: true,
                },
                guilds: {
                  "123": {
                    slug: "friends-of-verso",
                    requireMention: false,
                    users: ["steipete"],
                    channels: {
                      general: { allow: true },
                    },
                  },
                },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      vi.resetModules();
      const { loadConfig } = await import("./config.js");
      const cfg = loadConfig();

      expect(cfg.channels?.discord?.enabled).toBe(true);
      expect(cfg.channels?.discord?.dm?.groupEnabled).toBe(true);
      expect(cfg.channels?.discord?.dm?.groupChannels).toEqual(["verso-dm"]);
      expect(cfg.channels?.discord?.actions?.emojiUploads).toBe(true);
      expect(cfg.channels?.discord?.actions?.stickerUploads).toBe(false);
      expect(cfg.channels?.discord?.actions?.channels).toBe(true);
      expect(cfg.channels?.discord?.guilds?.["123"]?.slug).toBe("friends-of-verso");
      expect(cfg.channels?.discord?.guilds?.["123"]?.channels?.general?.allow).toBe(true);
    });
  });
});
