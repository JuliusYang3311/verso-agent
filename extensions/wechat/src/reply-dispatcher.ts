import type { VersoConfig, RuntimeEnv, ReplyPayload } from "verso/plugin-sdk";
import { createReplyPrefixContext } from "verso/plugin-sdk";
import { ProxyClient } from "./proxy-client.js";
import { getWeChatRuntime } from "./runtime.js";

export type CreateWeChatReplyDispatcherParams = {
  cfg: VersoConfig;
  agentId: string;
  runtime: RuntimeEnv;
  apiKey: string;
  proxyUrl: string;
  replyTo: string;
  accountId: string;
};

export function createWeChatReplyDispatcher(params: CreateWeChatReplyDispatcherParams) {
  const core = getWeChatRuntime();
  const { cfg, agentId, runtime, apiKey, proxyUrl, replyTo, accountId } = params;

  const prefixContext = createReplyPrefixContext({ cfg, agentId });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(cfg, "wechat", accountId, {
    fallbackLimit: 5000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "wechat");

  const client = new ProxyClient({ apiKey, accountId, baseUrl: proxyUrl });

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      deliver: async (payload: ReplyPayload) => {
        const text = payload.text ?? "";
        if (!text.trim()) return;

        const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
        for (const chunk of chunks) {
          await client.sendText(replyTo, chunk);
        }
      },
      onError: (err: unknown) => {
        runtime.error(`wechat[${accountId}] reply failed: ${String(err)}`);
      },
    });

  return {
    dispatcher,
    replyOptions: { ...replyOptions, onModelSelected: prefixContext.onModelSelected },
    markDispatchIdle,
  };
}
