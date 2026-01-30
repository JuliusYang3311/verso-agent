export type GoogleServiceId = "gmail" | "docs" | "sheets" | "slides" | "calendar" | "drive";

export type GoogleConfig = {
  /** Enable Google Workspace integration. */
  enabled?: boolean;
  /** Path to the Google OAuth2 JSON file (Client ID/Secret). */
  oauthJsonPath?: string;
  /** Path to the stored tokens JSON (e.g. .verso/google-tokens.json). */
  tokensPath?: string;
  /** Specific services to enable. */
  services?: GoogleServiceId[];
  /** Default Google Drive folder ID to store generated files. */
  defaultDriveFolderId?: string;
  /** Optional local path for temporary file uploads or downloads. */
  uploadPath?: string;
};
