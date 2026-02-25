import { prepareImageForMsgItem } from "./image-processor.js";

/** WeCom enforces a 20480-byte UTF-8 content limit per stream response. */
const MAX_STREAM_BYTES = 20480;

function enforceByteLimit(content: string): string {
  if (Buffer.byteLength(content, "utf8") <= MAX_STREAM_BYTES) return content;
  return Buffer.from(content, "utf8").subarray(0, MAX_STREAM_BYTES).toString("utf8");
}

interface StreamState {
  content: string;
  finished: boolean;
  updatedAt: number;
  feedbackId: string | null;
  msgItem: Array<{ msgtype: string; image: { base64: string; md5: string } }>;
  pendingImages: Array<{ path: string; queuedAt: number }>;
}

class StreamManager {
  private streams = new Map<string, StreamState>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref?.();
  }

  stopCleanup(): void {
    if (!this.cleanupTimer) return;
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  createStream(streamId: string, options: { feedbackId?: string } = {}): string {
    this.startCleanup();
    this.streams.set(streamId, {
      content: "",
      finished: false,
      updatedAt: Date.now(),
      feedbackId: options.feedbackId || null,
      msgItem: [],
      pendingImages: [],
    });
    return streamId;
  }

  updateStream(
    streamId: string,
    content: string,
    finished = false,
    options: { msgItem?: StreamState["msgItem"] } = {},
  ): boolean {
    const stream = this.streams.get(streamId);
    if (!stream) return false;
    stream.content = enforceByteLimit(content);
    stream.finished = finished;
    stream.updatedAt = Date.now();
    if (finished && options.msgItem?.length) stream.msgItem = options.msgItem.slice(0, 10);
    return true;
  }

  appendStream(streamId: string, chunk: string): boolean {
    const stream = this.streams.get(streamId);
    if (!stream) return false;
    stream.content = enforceByteLimit(stream.content + chunk);
    stream.updatedAt = Date.now();
    return true;
  }

  replaceIfPlaceholder(streamId: string, chunk: string, placeholder: string): boolean {
    const stream = this.streams.get(streamId);
    if (!stream) return false;
    if (stream.content.trim() === placeholder.trim()) {
      stream.content = enforceByteLimit(chunk);
    } else {
      stream.content = enforceByteLimit(stream.content + chunk);
    }
    stream.updatedAt = Date.now();
    return true;
  }

  queueImage(streamId: string, imagePath: string): boolean {
    const stream = this.streams.get(streamId);
    if (!stream) return false;
    stream.pendingImages.push({ path: imagePath, queuedAt: Date.now() });
    return true;
  }

  async processPendingImages(streamId: string): Promise<StreamState["msgItem"]> {
    const stream = this.streams.get(streamId);
    if (!stream || stream.pendingImages.length === 0) return [];
    const items: StreamState["msgItem"] = [];
    for (const img of stream.pendingImages) {
      if (items.length >= 10) break;
      try {
        const processed = await prepareImageForMsgItem(img.path);
        items.push({ msgtype: "image", image: { base64: processed.base64, md5: processed.md5 } });
      } catch {
        // Skip failed images
      }
    }
    return items;
  }

  async finishStream(streamId: string): Promise<boolean> {
    const stream = this.streams.get(streamId);
    if (!stream) return false;
    if (stream.finished) return true;
    if (stream.pendingImages.length > 0) {
      stream.msgItem = await this.processPendingImages(streamId);
      stream.pendingImages = [];
    }
    stream.finished = true;
    stream.updatedAt = Date.now();
    return true;
  }

  getStream(streamId: string): StreamState | undefined {
    return this.streams.get(streamId);
  }

  hasStream(streamId: string): boolean {
    return this.streams.has(streamId);
  }

  deleteStream(streamId: string): boolean {
    return this.streams.delete(streamId);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, stream] of this.streams) {
      if (now - stream.updatedAt > 10 * 60 * 1000) this.streams.delete(id);
    }
  }
}

export const streamManager = new StreamManager();
