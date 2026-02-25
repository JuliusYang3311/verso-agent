import type { ChannelOnboardingAdapter, VersoConfig, WizardPrompter } from "verso/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "verso/plugin-sdk";
import type { WeChatConfig } from "./types.js";
import { ProxyClient } from "./proxy-client.js";

const channel = "wechat" as const;

export const wechatOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,

  getStatus: async ({ cfg }) => {
    const wechatCfg = cfg.channels?.wechat as WeChatConfig | undefined;
    const hasApiKey = Boolean(wechatCfg?.apiKey?.trim());
    const hasProxyUrl = Boolean(wechatCfg?.proxyUrl?.trim());
    const configured = hasApiKey && hasProxyUrl;

    let probeOk = false;
    let probeNick: string | undefined;
    if (configured) {
      try {
        const client = new ProxyClient({
          apiKey: wechatCfg!.apiKey!,
          accountId: DEFAULT_ACCOUNT_ID,
          baseUrl: wechatCfg!.proxyUrl!,
        });
        const status = await client.getStatus();
        probeOk = status.valid && status.isLoggedIn;
        probeNick = status.nickName;
      } catch {
        // probe failed, not critical
      }
    }

    const statusLines: string[] = [];
    if (!configured) {
      statusLines.push("WeChat: needs API Key and Proxy URL");
    } else if (probeOk) {
      statusLines.push(`WeChat: connected as ${probeNick ?? "unknown"}`);
    } else {
      statusLines.push("WeChat: configured (not logged in)");
    }

    return {
      channel,
      configured,
      statusLines,
      selectionHint: configured ? "configured" : "needs API key",
      quickstartScore: configured ? 2 : 0,
    };
  },

  configure: async ({ cfg, prompter }) => {
    const wechatCfg = cfg.channels?.wechat as WeChatConfig | undefined;
    const hasExisting = Boolean(wechatCfg?.apiKey?.trim() && wechatCfg?.proxyUrl?.trim());

    let next = cfg;
    let apiKey: string | null = null;
    let proxyUrl: string | null = null;
    let webhookHost: string | undefined;
    let webhookPort: number | undefined;

    if (hasExisting) {
      const keep = await prompter.confirm({
        message: "WeChat credentials already configured. Keep them?",
        initialValue: true,
      });
      if (!keep) {
        ({ apiKey, proxyUrl, webhookHost, webhookPort } = await promptWeChatCredentials(prompter));
      }
    } else {
      await prompter.note(
        [
          "WeChat channel uses a proxy service to connect.",
          "You need an API Key and the proxy server URL.",
          "Contact the proxy service provider to obtain these.",
        ].join("\n"),
        "WeChat setup",
      );
      ({ apiKey, proxyUrl, webhookHost, webhookPort } = await promptWeChatCredentials(prompter));
    }

    if (apiKey && proxyUrl) {
      next = {
        ...next,
        channels: {
          ...next.channels,
          wechat: {
            ...next.channels?.wechat,
            enabled: true,
            apiKey,
            proxyUrl,
            ...(webhookHost ? { webhookHost } : {}),
            ...(webhookPort ? { webhookPort } : {}),
          },
        },
      };

      // Test connection
      try {
        const client = new ProxyClient({
          apiKey,
          accountId: DEFAULT_ACCOUNT_ID,
          baseUrl: proxyUrl,
        });
        const status = await client.getStatus();
        if (status.valid) {
          const msg = status.isLoggedIn
            ? `Connected as ${status.nickName ?? status.wcId ?? "unknown"}`
            : "API Key valid. You will need to scan QR code on gateway start.";
          await prompter.note(msg, "WeChat connection test");
        } else {
          await prompter.note(
            `API Key invalid: ${status.error ?? "unknown error"}`,
            "WeChat connection test",
          );
        }
      } catch (err) {
        await prompter.note(`Connection test failed: ${String(err)}`, "WeChat connection test");
      }
    } else if (!hasExisting) {
      // Nothing configured, just enable
      next = {
        ...next,
        channels: {
          ...next.channels,
          wechat: { ...next.channels?.wechat, enabled: true },
        },
      };
    }

    return { cfg: next, accountId: DEFAULT_ACCOUNT_ID };
  },

  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      wechat: { ...cfg.channels?.wechat, enabled: false },
    },
  }),
};

async function promptWeChatCredentials(prompter: WizardPrompter) {
  const apiKey = String(
    await prompter.text({
      message: "Enter WeChat Proxy API Key",
      validate: (value) => (value?.trim() ? undefined : "Required"),
    }),
  ).trim();

  const proxyUrl = String(
    await prompter.text({
      message: "Enter Proxy Server URL (e.g. http://your-server:3000)",
      validate: (value) => (value?.trim() ? undefined : "Required"),
    }),
  ).trim();

  const webhookHostRaw = String(
    (await prompter.text({
      message: "Webhook public host (IP or domain, leave empty for auto-detect)",
      placeholder: "your-public-ip",
    })) ?? "",
  ).trim();

  const webhookPortRaw = String(
    (await prompter.text({
      message: "Webhook port",
      placeholder: "18790",
      initialValue: "18790",
    })) ?? "",
  ).trim();

  return {
    apiKey,
    proxyUrl,
    webhookHost: webhookHostRaw || undefined,
    webhookPort: webhookPortRaw ? parseInt(webhookPortRaw, 10) || undefined : undefined,
  };
}
