import { complete, type Tool } from "@mariozechner/pi-ai";
/**
 * Interstitial reply: probe the model during an active agent turn.
 *
 * When a message arrives while an agent turn is already running, this module
 * makes a single model call with the same prompt construction and tool
 * declarations. If the model can answer without tools, the text is delivered
 * immediately. If the model signals tool use, the caller queues a full agent
 * turn to run after the current one ends.
 */
import { Type } from "@sinclair/typebox";
import type { VersoConfig } from "../../config/types.js";
import { resolveVersoAgentDir } from "../../agents/agent-paths.js";
import { getApiKeyForModel } from "../../agents/model-auth.js";
import { resolveDefaultModelForAgent } from "../../agents/model-selection.js";
import { resolveModel } from "../../agents/pi-embedded-runner/model.js";
import { logVerbose } from "../../globals.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("interstitial");

// ---------------------------------------------------------------------------
// Rate limiter — at most one probe per session per 10 seconds
// ---------------------------------------------------------------------------
const lastProbeTime = new Map<string, number>();
const PROBE_COOLDOWN_MS = 10_000;

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - PROBE_COOLDOWN_MS * 10;
  for (const [key, time] of lastProbeTime) {
    if (time < cutoff) {
      lastProbeTime.delete(key);
    }
  }
}, 60_000);
cleanupTimer.unref?.();

// ---------------------------------------------------------------------------
// Simplified tool declarations for intent detection.
// The model sees these and decides whether it needs tools.  The actual
// tool implementations are never invoked here — we only inspect stopReason.
// ---------------------------------------------------------------------------
const PROBE_TOOLS: Tool[] = [
  {
    name: "exec",
    description: "Execute a shell command on the host machine",
    parameters: Type.Object({
      command: Type.String({ description: "The shell command to run" }),
    }),
  },
  {
    name: "read",
    description: "Read a file from disk",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute file path" }),
    }),
  },
  {
    name: "write",
    description: "Write content to a file",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute file path" }),
      content: Type.String({ description: "File content" }),
    }),
  },
  {
    name: "web_search",
    description: "Search the web for information",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),
  },
  {
    name: "memory_search",
    description: "Search conversation memory and saved knowledge",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),
  },
  {
    name: "message",
    description: "Send a message to a user or channel",
    parameters: Type.Object({
      to: Type.String({ description: "Recipient identifier" }),
      text: Type.String({ description: "Message text" }),
    }),
  },
];

// ---------------------------------------------------------------------------
// Probe result type
// ---------------------------------------------------------------------------
export type ProbeResult = { type: "text"; text: string } | { type: "needs_tools" } | null;

// ---------------------------------------------------------------------------
// Main probe function
// ---------------------------------------------------------------------------
export async function probeInterstitialReply(params: {
  message: string;
  sessionKey: string;
  agentId: string;
  cfg: VersoConfig;
  systemPromptHint?: string;
  signal?: AbortSignal;
}): Promise<ProbeResult> {
  // Rate limit check
  const now = Date.now();
  const lastTime = lastProbeTime.get(params.sessionKey) ?? 0;
  if (now - lastTime < PROBE_COOLDOWN_MS) {
    log.debug("probe rate-limited", { sessionKey: params.sessionKey });
    return null;
  }
  lastProbeTime.set(params.sessionKey, now);

  try {
    // Resolve model — same resolution path as a normal agent turn
    const modelRef = resolveDefaultModelForAgent({
      cfg: params.cfg,
      agentId: params.agentId,
    });
    const agentDir = resolveVersoAgentDir();
    const resolved = resolveModel(modelRef.provider, modelRef.model, agentDir, params.cfg);
    if (!resolved.model) {
      log.debug(`probe: model resolution failed: ${resolved.error ?? "unknown"}`);
      return null;
    }
    const model = resolved.model;

    // Resolve API key
    const authInfo = await getApiKeyForModel({ model, cfg: params.cfg, agentDir });
    const apiKey = authInfo.apiKey;
    if (!apiKey) {
      log.debug("probe: no API key available");
      return null;
    }

    // Build context — full prompt construction with tool declarations
    const systemPrompt =
      params.systemPromptHint ??
      [
        "You are a helpful AI assistant currently in the middle of another task.",
        "A user has sent a new message. Follow these rules:",
        "1. If you can answer directly from your knowledge, respond concisely.",
        "2. If you need to run commands, read files, search the web, or use any",
        "   tool to answer properly, use the appropriate tool.",
        "3. Keep responses brief — the user knows you are busy with another task.",
      ].join("\n");

    const context = {
      systemPrompt,
      messages: [
        {
          role: "user" as const,
          content: params.message,
          timestamp: Date.now(),
        },
      ],
      tools: PROBE_TOOLS,
    };

    // Single model call — tools are declared but never executed
    const result = await complete(model, context, {
      apiKey,
      maxTokens: 1024,
      signal: params.signal,
    });

    if (result.stopReason === "toolUse") {
      logVerbose("interstitial probe: model needs tools, will queue full turn");
      return { type: "needs_tools" };
    }

    // Extract text
    const textPart = result.content.find(
      (c): c is { type: "text"; text: string } => c.type === "text",
    );
    if (textPart?.text?.trim()) {
      logVerbose(`interstitial probe: immediate text response (${textPart.text.length} chars)`);
      return { type: "text", text: textPart.text.trim() };
    }

    return null;
  } catch (err) {
    log.debug(`probe failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
