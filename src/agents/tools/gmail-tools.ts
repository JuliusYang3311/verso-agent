import { Type } from "@sinclair/typebox";
import { google } from "googleapis";
import { getGoogleOAuthClient } from "../google-auth.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import type { AnyAgentTool } from "./common.js";

export const gmailListMessages: AnyAgentTool = {
  name: "gmail_list_messages",
  label: "List Gmail Messages",
  description: "List recent messages from the user's Gmail inbox.",
  parameters: Type.Object({
    q: Type.Optional(
      Type.String({ description: "Search query (same format as Gmail search box)" }),
    ),
    maxResults: Type.Optional(
      Type.Number({ description: "Max results to return (default: 10)", default: 10 }),
    ),
  }),
  async execute(_toolCallId, params) {
    const auth = await getGoogleOAuthClient();
    if (!auth) throw new Error("Google Workspace is not enabled in your configuration.");

    const gmail = google.gmail({ version: "v1", auth });
    const q = readStringParam(params, "q") || "";
    const maxResults = readNumberParam(params, "maxResults") || 10;

    const res = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults,
    });

    return jsonResult(res.data);
  },
};

export const gmailGetMessage: AnyAgentTool = {
  name: "gmail_get_message",
  label: "Get Gmail Message",
  description: "Get details of a specific Gmail message by ID.",
  parameters: Type.Object({
    id: Type.String({ description: "The message ID" }),
  }),
  async execute(_toolCallId, params) {
    const auth = await getGoogleOAuthClient();
    if (!auth) throw new Error("Google Workspace is not enabled in your configuration.");

    const gmail = google.gmail({ version: "v1", auth });
    const id = readStringParam(params, "id", { required: true });

    const res = await gmail.users.messages.get({
      userId: "me",
      id,
    });

    // Simple text extraction for the agent
    const part =
      res.data.payload?.parts?.find((p: any) => p.mimeType === "text/plain") || res.data.payload;
    const body = part?.body?.data ? Buffer.from(part.body.data, "base64").toString("utf-8") : "";

    return jsonResult({
      ...res.data,
      bodyText: body,
    });
  },
};

export const gmailSendEmail: AnyAgentTool = {
  name: "gmail_send_email",
  label: "Send Gmail Email",
  description: "Send an email via Gmail.",
  parameters: Type.Object({
    to: Type.String({ description: "Recipient email address" }),
    subject: Type.String({ description: "Email subject" }),
    body: Type.String({ description: "Email body text" }),
  }),
  async execute(_toolCallId, params) {
    const auth = await getGoogleOAuthClient();
    if (!auth) throw new Error("Google Workspace is not enabled in your configuration.");

    const gmail = google.gmail({ version: "v1", auth });
    const to = readStringParam(params, "to", { required: true });
    const subject = readStringParam(params, "subject", { required: true });
    const body = readStringParam(params, "body", { required: true });

    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
    const messageParts = [
      `To: ${to}`,
      "Content-Type: text/plain; charset=utf-8",
      "MIME-Version: 1.0",
      `Subject: ${utf8Subject}`,
      "",
      body,
    ];
    const message = messageParts.join("\n");

    const encodedMessage = Buffer.from(message)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
      },
    });

    return jsonResult(res.data);
  },
};
