/**
 * WeCom (Enterprise WeChat) AI Bot channel types.
 */

// --- Account config ---

export interface WecomAccountConfig {
  enabled?: boolean;
  name?: string;
  token?: string;
  encodingAesKey?: string;
  webhookPath?: string;
  allowFrom?: string[];
  commands?: {
    enabled?: boolean;
    allowlist?: string[];
    blockMessage?: string;
  };
  dynamicAgents?: {
    enabled?: boolean;
  };
  dm?: {
    createAgentOnFirstMessage?: boolean;
    allowFrom?: string[];
  };
  groupChat?: {
    enabled?: boolean;
    requireMention?: boolean;
    mentionPatterns?: string[];
  };
  adminUsers?: string[];
}

export interface WecomConfig extends WecomAccountConfig {
  accounts?: Record<string, WecomAccountConfig>;
}

export interface ResolvedWecomAccount {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  token: string;
  encodingAesKey: string;
  webhookPath: string;
  config: WecomAccountConfig;
}

// --- Inbound message ---

export interface WecomInboundMessage {
  msgId: string;
  msgType: string;
  content: string;
  fromUser: string;
  chatType: string;
  chatId: string;
  aibotId?: string;
  responseUrl?: string;
  quote?: { msgType: string; content: string } | null;
  imageUrl?: string;
  imageUrls?: string[];
  fileUrl?: string;
  fileName?: string;
}

export interface WecomStreamRequest {
  id: string;
}

export interface WecomEvent {
  event_type?: string;
  from?: { userid?: string };
}

export type WecomHandleResult =
  | { message: WecomInboundMessage; query: { timestamp: string; nonce: string } }
  | { stream: WecomStreamRequest; query: { timestamp: string; nonce: string }; rawData?: unknown }
  | { event: WecomEvent; query: { timestamp: string; nonce: string } }
  | typeof WECOM_DUPLICATE
  | null;

export const WECOM_DUPLICATE = Symbol.for("wecom.duplicate");

// --- Config schema ---

export const wecomConfigSchema = {
  $schema: "http://json-schema.org/draft-07/schema#" as const,
  type: "object" as const,
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" as const, description: "Enable WeCom channel", default: true },
    token: { type: "string" as const, description: "WeCom bot token from admin console" },
    encodingAesKey: {
      type: "string" as const,
      description: "WeCom message encryption key (43 characters)",
      minLength: 43,
      maxLength: 43,
    },
    webhookPath: {
      type: "string" as const,
      description: "Webhook URL path",
      default: "/webhooks/wecom",
    },
    commands: {
      type: "object" as const,
      description: "Command whitelist configuration",
      additionalProperties: false,
      properties: {
        enabled: {
          type: "boolean" as const,
          description: "Enable command whitelist filtering",
          default: true,
        },
        allowlist: {
          type: "array" as const,
          description: "Allowed commands",
          items: { type: "string" as const },
          default: ["/new", "/status", "/help", "/compact"],
        },
      },
    },
    dynamicAgents: {
      type: "object" as const,
      description: "Dynamic agent routing configuration",
      additionalProperties: false,
      properties: {
        enabled: {
          type: "boolean" as const,
          description: "Enable per-user/per-group agent isolation",
          default: true,
        },
      },
    },
    dm: {
      type: "object" as const,
      description: "Direct message configuration",
      additionalProperties: false,
      properties: {
        createAgentOnFirstMessage: {
          type: "boolean" as const,
          description: "Create separate agent for each user",
          default: true,
        },
      },
    },
    groupChat: {
      type: "object" as const,
      description: "Group chat configuration",
      additionalProperties: false,
      properties: {
        enabled: {
          type: "boolean" as const,
          description: "Enable group chat support",
          default: true,
        },
        requireMention: {
          type: "boolean" as const,
          description: "Only respond when @mentioned in groups",
          default: true,
        },
      },
    },
    adminUsers: {
      type: "array" as const,
      description: "Admin users who bypass command allowlist",
      items: { type: "string" as const },
      default: [],
    },
  },
};

// --- Constants ---

export const CONSTANTS = {
  AES_BLOCK_SIZE: 32,
  AES_KEY_LENGTH: 43,
} as const;

export const THINKING_PLACEHOLDER = "思考中...";

export const DEFAULT_COMMAND_ALLOWLIST = ["/new", "/compact", "/help", "/status"];

export const DEFAULT_COMMAND_BLOCK_MESSAGE = `⚠️ 该命令不可用。

支持的命令：
• **/new** - 新建会话
• **/compact** - 压缩会话（保留上下文摘要）
• **/help** - 查看帮助
• **/status** - 查看状态`;
