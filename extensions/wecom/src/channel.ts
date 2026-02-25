import type { ChannelPlugin, VersoConfig } from "verso/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "verso/plugin-sdk";
import type { ResolvedWecomAccount, WecomConfig } from "./types.js";
import { registerWebhookTarget } from "./http-handler.js";
import { wecomOnboardingAdapter } from "./onboarding.js";
import { wecomOutbound } from "./outbound.js";
import { wecomConfigSchema } from "./types.js";

function resolveWecomAccount(cfg: VersoConfig, accountId?: string | null): ResolvedWecomAccount {
  const id = accountId || DEFAULT_ACCOUNT_ID;
  const wecom = cfg.channels?.wecom as WecomConfig | undefined;

  return {
    accountId: id,
    enabled: wecom?.enabled !== false,
    configured: Boolean(wecom?.token?.trim() && wecom?.encodingAesKey?.trim()),
    name: wecom?.name,
    token: wecom?.token || "",
    encodingAesKey: wecom?.encodingAesKey || "",
    webhookPath: wecom?.webhookPath || "/webhooks/wecom",
    config: wecom || { token: "", encodingAesKey: "" },
  };
}

function listWecomAccountIds(cfg: VersoConfig): string[] {
  const wecom = cfg.channels?.wecom as WecomConfig | undefined;
  if (!wecom || wecom.enabled === false) return [];
  return [DEFAULT_ACCOUNT_ID];
}

export const wecomPlugin: ChannelPlugin<ResolvedWecomAccount> = {
  id: "wecom",

  meta: {
    id: "wecom",
    label: "Enterprise WeChat",
    selectionLabel: "Enterprise WeChat (AI Bot)",
    docsPath: "/channels/wecom",
    blurb: "Enterprise WeChat AI Bot channel plugin",
    order: 90,
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    polls: false,
  },

  configSchema: { schema: wecomConfigSchema },

  config: {
    listAccountIds: (cfg) => listWecomAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveWecomAccount(cfg, accountId),
    defaultAccountId: (cfg) => {
      const ids = listWecomAccountIds(cfg);
      return ids[0] || DEFAULT_ACCOUNT_ID;
    },
    setAccountEnabled: ({ cfg, accountId: _accountId, enabled }) => {
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          wecom: { ...cfg.channels?.wecom, enabled },
        },
      };
    },
    deleteAccount: ({ cfg }) => {
      const next = { ...cfg };
      const nextChannels = { ...cfg.channels } as Record<string, unknown>;
      delete nextChannels.wecom;
      next.channels = Object.keys(nextChannels).length > 0 ? nextChannels : undefined;
      return next;
    },
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name || account.accountId,
    }),
    resolveAllowFrom: () => [],
    formatAllowFrom: ({ allowFrom }) => allowFrom.map(String),
  },

  onboarding: wecomOnboardingAdapter,

  messaging: {
    normalizeTarget: (raw) => {
      if (raw.startsWith("wecom:")) return raw.slice(6);
      if (raw.startsWith("user:")) return raw.slice(5);
      if (raw.startsWith("group:")) return raw.slice(6);
      return raw;
    },
    targetResolver: {
      looksLikeId: (id) => /^[a-zA-Z0-9_-]+$/.test(id),
      hint: "<userid|group:chatid|wecom:userid>",
    },
  },

  agentPrompt: {
    messageToolHints: () => [
      "- WeCom targeting: use `wecom:<userid>` for direct messages, `group:<chatid>` for groups.",
    ],
  },

  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
  },

  status: {
    probeAccount: async ({ account }) => {
      if (!account.configured) return { ok: false, error: "Not configured" };
      try {
        // Validate crypto round-trip
        const { WecomCrypto } = await import("./crypto.js");
        const crypto = new WecomCrypto(account.token, account.encodingAesKey);
        const encrypted = crypto.encrypt("probe");
        const decrypted = crypto.decrypt(encrypted);
        return { ok: decrypted.message === "probe" };
      } catch (err: unknown) {
        return { ok: false, error: String(err) };
      }
    },
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      running: runtime?.running ?? false,
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      const { cfg, accountId, log } = ctx;
      const account = resolveWecomAccount(cfg, accountId);

      if (!account.configured) {
        throw new Error("WeCom account not configured: missing token or encodingAesKey");
      }

      log?.info(`WeCom gateway starting, webhook path: ${account.webhookPath}`);

      const unregister = registerWebhookTarget({
        path: account.webhookPath,
        account,
        config: cfg,
      });

      ctx.setStatus?.({ accountId: account.accountId, running: true });
      log?.info(`WeCom account ${account.accountId} started`);

      return {
        async stop() {
          unregister();
          ctx.setStatus?.({ accountId: account.accountId, running: false });
        },
      };
    },
  },

  outbound: wecomOutbound,

  security: {
    collectWarnings: () => [],
  },

  setup: {
    applyAccountConfig: ({ cfg, accountId }) => {
      const isDefault = !accountId || accountId === DEFAULT_ACCOUNT_ID;
      if (isDefault) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            wecom: { ...cfg.channels?.wecom, enabled: true },
          },
        };
      }
      return cfg;
    },
  },
};
