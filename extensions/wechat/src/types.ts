export interface WeChatAccountConfig {
  enabled?: boolean;
  name?: string;
  apiKey: string;
  proxyUrl?: string;
  deviceType?: "ipad" | "mac";
  proxy?: string;
  webhookHost?: string;
  webhookPort?: number;
  webhookPath?: string;
  wcId?: string;
  nickName?: string;
}

export interface WeChatConfig {
  enabled?: boolean;
  apiKey?: string;
  proxyUrl?: string;
  deviceType?: "ipad" | "mac";
  proxy?: string;
  webhookHost?: string;
  webhookPort?: number;
  webhookPath?: string;
  accounts?: Record<string, WeChatAccountConfig | undefined>;
}

export type ResolvedWeChatAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  apiKey: string;
  proxyUrl: string;
  wcId?: string;
  isLoggedIn: boolean;
  nickName?: string;
  deviceType: string;
  proxy: string;
  webhookHost?: string;
  webhookPort: number;
  webhookPath: string;
  config: WeChatAccountConfig;
};

export type LoginStatus =
  | { status: "waiting" }
  | { status: "need_verify"; verifyUrl: string }
  | { status: "logged_in"; wcId: string; nickName: string; headUrl?: string };

export type ProxyClientConfig = {
  apiKey: string;
  accountId: string;
  baseUrl: string;
};

export type WeChatMessageContext = {
  id: string;
  type: "text" | "image" | "video" | "file" | "voice" | "unknown";
  sender: { id: string; name: string };
  recipient: { id: string };
  content: string;
  timestamp: number;
  threadId: string;
  group?: { id: string; name: string };
  raw: unknown;
};

export const wechatConfigSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },
    apiKey: { type: "string" },
    proxyUrl: { type: "string" },
    deviceType: { type: "string", enum: ["ipad", "mac"] },
    proxy: { type: "string" },
    webhookHost: { type: "string" },
    webhookPort: { type: "integer" },
    webhookPath: { type: "string" },
    accounts: {
      type: "object" as const,
      additionalProperties: {
        type: "object" as const,
        additionalProperties: true,
        properties: {
          enabled: { type: "boolean" },
          name: { type: "string" },
          apiKey: { type: "string" },
          proxyUrl: { type: "string" },
          deviceType: { type: "string", enum: ["ipad", "mac"] },
          proxy: { type: "string" },
          webhookHost: { type: "string" },
          webhookPort: { type: "integer" },
          webhookPath: { type: "string" },
          wcId: { type: "string" },
          nickName: { type: "string" },
        },
        required: ["apiKey"],
      },
    },
  },
};
