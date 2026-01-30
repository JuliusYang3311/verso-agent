import type { GoogleConfig, GoogleServiceId } from "../config/types.google.js";
import type { VersoConfig } from "../config/types.verso.js";
import type { RuntimeEnv } from "../runtime.js";
import { note } from "../terminal/note.js";
import { confirm, select, text } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";

export async function promptGoogleConfig(
  nextConfig: VersoConfig,
  runtime: RuntimeEnv,
): Promise<VersoConfig> {
  const existing = nextConfig.google;

  note(
    [
      "Google Workspace integration provides tools for Gmail, Docs, Sheets, Slides, Calendar and Drive.",
      "It requires an OAuth2 JSON file from the Google Cloud Console.",
      "You can also configure a default Drive folder for generated files.",
      "Docs: https://docs.molt.bot/tools/google",
    ].join("\n"),
    "Google Workspace",
  );

  const enable = guardCancel(
    await confirm({
      message: "Enable Google Workspace tools?",
      initialValue: existing?.enabled ?? false,
    }),
    runtime,
  );

  if (!enable) {
    return {
      ...nextConfig,
      google: {
        ...existing,
        enabled: false,
      },
    };
  }

  const oauthJsonPath = guardCancel(
    await text({
      message: "Path to Google OAuth2 JSON file (or raw JSON content)",
      initialValue: existing?.oauthJsonPath,
      placeholder: "~/Downloads/client_secret_....json or {...}",
    }),
    runtime,
  );

  const defaultDriveFolderId = guardCancel(
    await text({
      message: "Default Google Drive Folder ID (optional)",
      initialValue: existing?.defaultDriveFolderId,
      placeholder: "Leave blank for root",
    }),
    runtime,
  );

  const uploadPath = guardCancel(
    await text({
      message: "Local path for file storage/uploads (optional)",
      initialValue: existing?.uploadPath,
      placeholder: "~/Documents/verso-google-files",
    }),
    runtime,
  );

  const SERVICES: Array<{ value: GoogleServiceId; label: string }> = [
    { value: "gmail", label: "Gmail" },
    { value: "docs", label: "Google Docs" },
    { value: "sheets", label: "Google Sheets" },
    { value: "calendar", label: "Google Calendar" },
    { value: "slides", label: "Google Slides" },
    { value: "drive", label: "Google Drive" },
  ];

  // Clack multiselect might be better, but we only have select in configure.shared.
  // Let's assume for now we enable all or skip.
  // Actually, I'll just default to all for now or keep it simple.

  const nextGoogle: GoogleConfig = {
    ...existing,
    enabled: true,
    oauthJsonPath: String(oauthJsonPath ?? "").trim(),
    defaultDriveFolderId: String(defaultDriveFolderId ?? "").trim(),
    uploadPath: String(uploadPath ?? "").trim(),
    services: (existing?.services?.length
      ? existing.services
      : ["gmail", "docs", "sheets", "slides", "calendar", "drive"]) as GoogleServiceId[],
  };

  return {
    ...nextConfig,
    google: nextGoogle,
  };
}
