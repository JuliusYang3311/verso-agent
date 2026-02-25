import type { ChannelOutboundAdapter } from "verso/plugin-sdk";
import { streamContext, resolveActiveStream, responseUrls } from "./bot.js";
import { streamManager } from "./stream-manager.js";
import { THINKING_PLACEHOLDER } from "./types.js";

/**
 * WeCom outbound adapter — all replies go through stream updates.
 * Three-layer fallback: active stream → response_url → log warning.
 */
export const wecomOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  textChunkLimit: 20000,

  async sendText({ to, text }) {
    const userId = to.replace(/^wecom:/, "");
    const ctx = streamContext.getStore() as { streamId?: string; streamKey?: string } | undefined;
    const streamId = ctx?.streamId ?? resolveActiveStream(userId);

    // Layer 1: Active stream
    if (
      streamId &&
      streamManager.hasStream(streamId) &&
      !streamManager.getStream(streamId)?.finished
    ) {
      streamManager.replaceIfPlaceholder(streamId, text, THINKING_PLACEHOLDER);
      return { channel: "wecom", messageId: `msg_stream_${Date.now()}` };
    }

    // Layer 2: response_url fallback
    const saved = responseUrls.get(ctx?.streamKey ?? userId);
    if (saved && !saved.used && Date.now() < saved.expiresAt) {
      saved.used = true;
      try {
        await fetch(saved.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ msgtype: "text", text: { content: text } }),
        });
        return { channel: "wecom", messageId: `msg_response_url_${Date.now()}` };
      } catch {
        // Fall through to layer 3
      }
    }

    // Layer 3: No delivery channel
    return { channel: "wecom", messageId: `undelivered_${Date.now()}` };
  },

  async sendMedia({ to, text, mediaUrl }) {
    const userId = to.replace(/^wecom:/, "");
    const ctx = streamContext.getStore() as { streamId?: string; streamKey?: string } | undefined;
    const streamId = ctx?.streamId ?? resolveActiveStream(userId);

    if (streamId && streamManager.hasStream(streamId)) {
      if (mediaUrl) {
        const isLocalPath = mediaUrl.startsWith("sandbox:") || mediaUrl.startsWith("/");
        if (isLocalPath) {
          let absolutePath = mediaUrl;
          if (absolutePath.startsWith("sandbox:")) {
            absolutePath = absolutePath.replace(/^sandbox:\/{0,2}/, "");
            if (!absolutePath.startsWith("/")) absolutePath = "/" + absolutePath;
          }
          const queued = streamManager.queueImage(streamId, absolutePath);
          if (queued) {
            if (text) streamManager.replaceIfPlaceholder(streamId, text, THINKING_PLACEHOLDER);
            streamManager.appendStream(streamId, "\n\n[图片]");
            return { channel: "wecom", messageId: `msg_stream_img_${Date.now()}` };
          }
        }
      }
      // External URL or queue failed — use markdown
      const mediaRef = mediaUrl || "";
      const content = text ? `${text}\n\n![image](${mediaRef})` : `![image](${mediaRef})`;
      streamManager.replaceIfPlaceholder(streamId, content, THINKING_PLACEHOLDER);
      return { channel: "wecom", messageId: `msg_stream_${Date.now()}` };
    }

    return { channel: "wecom", messageId: `undelivered_${Date.now()}` };
  },
};
