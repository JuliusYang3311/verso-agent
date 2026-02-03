import type { ReplyPayload } from "../types.js";
import type { BlockStreamingCoalescing } from "./block-streaming.js";

export type BlockReplyCoalescer = {
  enqueue: (payload: ReplyPayload, sourceKey?: string) => void;
  flush: (options?: { force?: boolean }) => Promise<void>;
  hasBuffered: () => boolean;
  stop: () => void;
};

export function createBlockReplyCoalescer(params: {
  config: BlockStreamingCoalescing;
  shouldAbort: () => boolean;
  onFlush: (payload: ReplyPayload, sourceKeys?: Set<string>) => Promise<void> | void;
}): BlockReplyCoalescer {
  const { config, shouldAbort, onFlush } = params;
  const minChars = Math.max(1, Math.floor(config.minChars));
  const maxChars = Math.max(minChars, Math.floor(config.maxChars));
  const idleMs = Math.max(0, Math.floor(config.idleMs));
  const joiner = config.joiner ?? "";

  let bufferText = "";
  let bufferReplyToId: ReplyPayload["replyToId"];
  let bufferAudioAsVoice: ReplyPayload["audioAsVoice"];
  let bufferSourceKeys = new Set<string>();
  let idleTimer: NodeJS.Timeout | undefined;

  const clearIdleTimer = () => {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = undefined;
  };

  const resetBuffer = () => {
    bufferText = "";
    bufferReplyToId = undefined;
    bufferAudioAsVoice = undefined;
    bufferSourceKeys = new Set<string>();
  };

  const scheduleIdleFlush = () => {
    if (idleMs <= 0) return;
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      void flush({ force: false });
    }, idleMs);
  };

  const flush = async (options?: { force?: boolean }) => {
    clearIdleTimer();
    if (shouldAbort()) {
      resetBuffer();
      return;
    }
    if (!bufferText) return;
    if (!options?.force && bufferText.length < minChars) {
      scheduleIdleFlush();
      return;
    }
    const payload: ReplyPayload = {
      text: bufferText,
      replyToId: bufferReplyToId,
      audioAsVoice: bufferAudioAsVoice,
    };
    const keys = new Set(bufferSourceKeys);
    resetBuffer();
    await onFlush(payload, keys);
  };

  const enqueue = (payload: ReplyPayload, sourceKey?: string) => {
    if (shouldAbort()) return;
    const hasMedia = Boolean(payload.mediaUrl) || (payload.mediaUrls?.length ?? 0) > 0;
    const text = payload.text ?? "";
    const hasText = text.trim().length > 0;
    if (hasMedia) {
      void flush({ force: true });
      void onFlush(payload, sourceKey ? new Set([sourceKey]) : undefined);
      return;
    }
    if (!hasText) return;

    if (
      bufferText &&
      (bufferReplyToId !== payload.replyToId || bufferAudioAsVoice !== payload.audioAsVoice)
    ) {
      void flush({ force: true });
    }

    if (!bufferText) {
      bufferReplyToId = payload.replyToId;
      bufferAudioAsVoice = payload.audioAsVoice;
    }

    if (sourceKey) {
      bufferSourceKeys.add(sourceKey);
    }

    const nextText = bufferText ? `${bufferText}${joiner}${text}` : text;
    if (nextText.length > maxChars) {
      if (bufferText) {
        void flush({ force: true });
        bufferReplyToId = payload.replyToId;
        bufferAudioAsVoice = payload.audioAsVoice;
        if (sourceKey) {
          bufferSourceKeys.add(sourceKey);
        }
        if (text.length >= maxChars) {
          void onFlush(payload, sourceKey ? new Set([sourceKey]) : undefined);
          return;
        }
        bufferText = text;
        scheduleIdleFlush();
        return;
      }
      void onFlush(payload, sourceKey ? new Set([sourceKey]) : undefined);
      return;
    }

    bufferText = nextText;
    if (bufferText.length >= maxChars) {
      void flush({ force: true });
      return;
    }
    scheduleIdleFlush();
  };

  return {
    enqueue,
    flush,
    hasBuffered: () => Boolean(bufferText),
    stop: () => clearIdleTimer(),
  };
}
