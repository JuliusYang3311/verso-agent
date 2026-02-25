import type { ChannelPlugin, VersoConfig } from "verso/plugin-sdk";
import { networkInterfaces } from "node:os";
import { DEFAULT_ACCOUNT_ID } from "verso/plugin-sdk";
import type { ResolvedWeChatAccount, WeChatConfig, WeChatAccountConfig } from "./types.js";
import { handleWeChatMessage } from "./bot.js";
import { startWeChatMonitor } from "./monitor.js";
import { wechatOnboardingAdapter } from "./onboarding.js";
import { ProxyClient } from "./proxy-client.js";
import { wechatConfigSchema } from "./types.js";

function resolveWeChatAccount(cfg: VersoConfig, accountId?: string | null): ResolvedWeChatAccount {
  const id = accountId || DEFAULT_ACCOUNT_ID;
  const wechatCfg = cfg.channels?.wechat as WeChatConfig | undefined;
  const isDefault = id === DEFAULT_ACCOUNT_ID;

  let accountCfg: WeChatAccountConfig | undefined;
  let enabled: boolean;

  if (isDefault) {
    const topLevel: WeChatAccountConfig = {
      apiKey: wechatCfg?.apiKey || "",
      proxyUrl: wechatCfg?.proxyUrl,
      deviceType: wechatCfg?.deviceType,
      proxy: wechatCfg?.proxy,
      webhookHost: wechatCfg?.webhookHost,
      webhookPort: wechatCfg?.webhookPort,
      webhookPath: wechatCfg?.webhookPath,
    };
    const defaultAccount = wechatCfg?.accounts?.default;
    accountCfg = {
      ...topLevel,
      ...defaultAccount,
      apiKey: topLevel.apiKey || defaultAccount?.apiKey || "",
    };
    enabled = accountCfg.enabled ?? wechatCfg?.enabled ?? true;
  } else {
    accountCfg = wechatCfg?.accounts?.[id];
    enabled = accountCfg?.enabled ?? true;
  }

  const configured = Boolean(accountCfg?.apiKey?.trim() && accountCfg?.proxyUrl?.trim());

  return {
    accountId: id,
    enabled,
    configured,
    name: accountCfg?.name,
    apiKey: accountCfg?.apiKey || "",
    proxyUrl: accountCfg?.proxyUrl || "",
    wcId: accountCfg?.wcId,
    isLoggedIn: Boolean(accountCfg?.wcId),
    nickName: accountCfg?.nickName,
    deviceType: accountCfg?.deviceType || "ipad",
    proxy: accountCfg?.proxy || "2",
    webhookHost: accountCfg?.webhookHost,
    webhookPort: accountCfg?.webhookPort || 18790,
    webhookPath: accountCfg?.webhookPath || "/webhook/wechat",
    config: accountCfg || { apiKey: "" },
  };
}

function listWeChatAccountIds(cfg: VersoConfig): string[] {
  const wechatCfg = cfg.channels?.wechat as WeChatConfig | undefined;
  if (wechatCfg?.apiKey) return [DEFAULT_ACCOUNT_ID];
  const accounts = wechatCfg?.accounts;
  if (!accounts) return [];
  return Object.keys(accounts).filter((id) => accounts[id]?.enabled !== false);
}

export const wechatPlugin: ChannelPlugin<ResolvedWeChatAccount> = {
  id: "wechat",

  meta: {
    id: "wechat",
    label: "WeChat",
    selectionLabel: "WeChat (微信)",
    docsPath: "/channels/wechat",
    blurb: "WeChat channel via Proxy API",
    order: 80,
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    polls: false,
  },

  configSchema: { schema: wechatConfigSchema },

  config: {
    listAccountIds: (cfg) => listWeChatAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveWeChatAccount(cfg, accountId),
    defaultAccountId: (cfg) => {
      const ids = listWeChatAccountIds(cfg);
      return ids[0] || DEFAULT_ACCOUNT_ID;
    },
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const wechatCfg = cfg.channels?.wechat as WeChatConfig | undefined;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return { ...cfg, channels: { ...cfg.channels, wechat: { ...wechatCfg, enabled } } };
      }
      const account = wechatCfg?.accounts?.[accountId];
      if (!account) throw new Error(`Account ${accountId} not found`);
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          wechat: {
            ...wechatCfg,
            accounts: { ...wechatCfg?.accounts, [accountId]: { ...account, enabled } },
          },
        },
      };
    },
    deleteAccount: ({ cfg, accountId }) => {
      const wechatCfg = cfg.channels?.wechat as WeChatConfig | undefined;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        const next = { ...cfg };
        const nextChannels = { ...cfg.channels } as Record<string, unknown>;
        delete nextChannels.wechat;
        next.channels = Object.keys(nextChannels).length > 0 ? nextChannels : undefined;
        return next;
      }
      const accounts = { ...wechatCfg?.accounts };
      delete accounts[accountId];
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          wechat: {
            ...wechatCfg,
            accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
          },
        },
      };
    },
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name || account.nickName || account.accountId,
    }),
    resolveAllowFrom: () => [],
    formatAllowFrom: ({ allowFrom }) => allowFrom.map(String),
  },

  onboarding: wechatOnboardingAdapter,

  messaging: {
    normalizeTarget: (raw) => {
      if (raw.startsWith("user:")) return raw.slice(5);
      if (raw.startsWith("group:")) return raw.slice(6);
      return raw;
    },
    targetResolver: {
      looksLikeId: (id) => id.startsWith("wxid_") || id.includes("@chatroom"),
      hint: "<wxid_xxx|xxxx@chatroom|user:wxid_xxx|group:xxx@chatroom>",
    },
  },

  agentPrompt: {
    messageToolHints: () => [
      "- WeChat targeting: use `user:<wcId>` for direct messages, `group:<chatRoomId>` for groups.",
    ],
  },

  directory: {
    self: async () => null,
    listPeers: async ({ cfg, limit, accountId }) => {
      const account = resolveWeChatAccount(cfg, accountId);
      if (!account.isLoggedIn || !account.wcId) return [];
      const client = new ProxyClient({
        apiKey: account.apiKey,
        accountId: account.accountId,
        baseUrl: account.proxyUrl,
      });
      const contacts = await client.getContacts(account.wcId);
      return contacts.friends
        .slice(0, limit ?? undefined)
        .map((id) => ({ kind: "user" as const, id, name: id }));
    },
    listGroups: async ({ cfg, limit, accountId }) => {
      const account = resolveWeChatAccount(cfg, accountId);
      if (!account.isLoggedIn || !account.wcId) return [];
      const client = new ProxyClient({
        apiKey: account.apiKey,
        accountId: account.accountId,
        baseUrl: account.proxyUrl,
      });
      const contacts = await client.getContacts(account.wcId);
      return contacts.chatrooms
        .slice(0, limit ?? undefined)
        .map((id) => ({ kind: "group" as const, id, name: id }));
    },
  },

  status: {
    probeAccount: async ({ account, cfg }) => {
      if (!account.configured) return { ok: false, error: "Not configured" };
      try {
        const client = new ProxyClient({
          apiKey: account.apiKey,
          accountId: account.accountId,
          baseUrl: account.proxyUrl,
        });
        const status = await client.getStatus();
        return { ok: status.valid && status.isLoggedIn, error: status.error };
      } catch (err: unknown) {
        return { ok: false, error: String(err) };
      }
    },
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name || account.nickName,
      wcId: account.wcId,
      isLoggedIn: account.isLoggedIn,
      running: runtime?.running ?? false,
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      const { cfg, accountId, abortSignal, setStatus, log } = ctx;
      const account = resolveWeChatAccount(cfg, accountId);

      if (!account.configured) {
        throw new Error("WeChat account not configured: missing apiKey or proxyUrl");
      }

      const client = new ProxyClient({
        apiKey: account.apiKey,
        accountId,
        baseUrl: account.proxyUrl,
      });

      // Check status and login if needed
      const status = await client.getStatus();
      if (!status.valid) throw new Error(`API Key invalid: ${status.error || "Unknown error"}`);

      if (!status.isLoggedIn) {
        log?.info("Not logged in, starting QR code login flow");
        const { qrCodeUrl, wId } = await client.getQRCode(account.deviceType, account.proxy);

        log?.info(`Please scan QR code to login: ${qrCodeUrl}`);

        let loginResult: { wcId: string; nickName: string } | null = null;
        for (let i = 0; i < 60; i++) {
          if (abortSignal?.aborted) throw new Error("Login aborted");
          await new Promise((r) => setTimeout(r, 5000));
          const check = await client.checkLogin(wId);
          if (check.status === "logged_in") {
            loginResult = check;
            break;
          }
          if (check.status === "need_verify") {
            log?.warn(`Verification required: ${check.verifyUrl}`);
          }
        }

        if (!loginResult) throw new Error("Login timeout: QR code expired");

        log?.info(`Login successful: ${loginResult.nickName} (${loginResult.wcId})`);
        account.wcId = loginResult.wcId;
        account.nickName = loginResult.nickName;
        account.isLoggedIn = true;
      } else {
        log?.info(`Already logged in: ${status.nickName} (${status.wcId})`);
        account.wcId = status.wcId;
        account.nickName = status.nickName;
        account.isLoggedIn = true;
      }

      // Determine webhook URL
      let webhookHost = account.webhookHost;
      if (!webhookHost) {
        const nets = networkInterfaces();
        let localIp = "localhost";
        for (const name of Object.keys(nets)) {
          for (const net of nets[name] || []) {
            if (net.family === "IPv4" && !net.internal) {
              localIp = net.address;
              break;
            }
          }
          if (localIp !== "localhost") break;
        }
        webhookHost = localIp;
        log?.warn(`webhookHost not configured, using auto-detected IP: ${localIp}`);
      }

      const port = account.webhookPort;
      const webhookUrl = `http://${webhookHost}:${port}${account.webhookPath}`;

      // Register webhook with proxy
      await client.registerWebhook(webhookUrl);
      log?.info(`Webhook registered: ${webhookUrl}`);

      // Start local webhook server
      const { stop } = await startWeChatMonitor({
        port,
        webhookPath: account.webhookPath,
        onMessage: (message) => {
          handleWeChatMessage({ cfg, message, runtime: ctx.runtime, accountId, account }).catch(
            (err) => {
              log?.error(`Failed to handle WeChat message: ${String(err)}`);
            },
          );
        },
        log: (msg) => log?.info(msg),
        abortSignal,
      });

      setStatus?.({ accountId, port, running: true });
      log?.info(`WeChat account ${accountId} started on port ${port}`);

      return {
        async stop() {
          stop();
          setStatus?.({ accountId, port, running: false });
        },
      };
    },
  },

  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 2000,

    async sendText({ cfg, to, text, accountId }) {
      const account = resolveWeChatAccount(cfg, accountId);
      if (!account.wcId) throw new Error("Not logged in");
      const client = new ProxyClient({
        apiKey: account.apiKey,
        accountId: account.accountId,
        baseUrl: account.proxyUrl,
      });
      const result = await client.sendText(to, text);
      return {
        channel: "wechat",
        messageId: String(result.newMsgId),
        timestamp: result.createTime,
      };
    },

    async sendMedia({ cfg, to, mediaUrl, text, accountId }) {
      const account = resolveWeChatAccount(cfg, accountId);
      if (!account.wcId) throw new Error("Not logged in");
      const client = new ProxyClient({
        apiKey: account.apiKey,
        accountId: account.accountId,
        baseUrl: account.proxyUrl,
      });
      if (text?.trim()) await client.sendText(to, text);
      if (mediaUrl) {
        const result = await client.sendImage(to, mediaUrl);
        return { channel: "wechat", messageId: String(result.newMsgId) };
      }
      return { channel: "wechat", messageId: "" };
    },
  },

  security: {
    collectWarnings: () => [],
  },

  setup: {
    applyAccountConfig: ({ cfg, accountId }) => {
      const wechatCfg = cfg.channels?.wechat as WeChatConfig | undefined;
      const isDefault = !accountId || accountId === DEFAULT_ACCOUNT_ID;
      if (isDefault) {
        return { ...cfg, channels: { ...cfg.channels, wechat: { ...wechatCfg, enabled: true } } };
      }
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          wechat: {
            ...wechatCfg,
            accounts: {
              ...wechatCfg?.accounts,
              [accountId]: { ...wechatCfg?.accounts?.[accountId], enabled: true },
            },
          },
        },
      };
    },
  },
};
