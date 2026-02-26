import { describe, expect, it } from "vitest";
import {
  formatChannelSelectionLine,
  listChatChannels,
  normalizeChatChannelId,
} from "./registry.js";

describe("channel registry", () => {
  it("normalizes known channel ids", () => {
    expect(normalizeChatChannelId("telegram")).toBe("telegram");
    expect(normalizeChatChannelId("discord")).toBe("discord");
    expect(normalizeChatChannelId("web")).toBeNull();
  });

  it("keeps Telegram first in the default order", () => {
    const channels = listChatChannels();
    expect(channels[0]?.id).toBe("telegram");
  });

  it("formats selection lines with docs labels", () => {
    const channels = listChatChannels();
    const first = channels[0];
    if (!first) {
      throw new Error("Missing channel metadata.");
    }
    const line = formatChannelSelectionLine(first, (path, label) =>
      [label, path].filter(Boolean).join(":"),
    );
    expect(line).not.toContain("Docs:");
    expect(line).toContain("/channels/telegram");
    expect(line).toContain("https://verso.ai");
  });
});
