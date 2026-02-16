import type { VersoConfig } from "../config/types.verso.js";
import type { RuntimeEnv } from "../runtime.js";
import { note } from "../terminal/note.js";
import { text } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";

export async function promptGhostConfig(
  nextConfig: VersoConfig,
  runtime: RuntimeEnv,
): Promise<VersoConfig> {
  const existingEntry = nextConfig.skills?.entries?.["ghost"] as
    | Record<string, unknown>
    | undefined;
  const existingEnv = existingEntry?.env ?? {};
  const existingConfig = existingEntry?.config ?? {}; // Fallback for old migration

  note(
    [
      "Ghost.io integration requires three parameters from your Custom Integration settings:",
      "1. API URL (e.g., https://my-blog.ghost.io)",
      "2. Content API Key (for reading content)",
      "3. Admin API Key (for publishing and management)",
      "",
      "Docs: https://ghost.org/docs/admin-api/",
    ].join("\n"),
    "Ghost.io Configuration",
  );

  const apiUrl = guardCancel(
    await text({
      message: "Ghost API URL",
      initialValue: existingEnv.GHOST_API_URL ?? existingConfig.apiUrl,
      placeholder: "https://your-blog.ghost.io",
      validate: (value) => (value?.trim() ? undefined : "Required"),
    }),
    runtime,
  );

  const contentApiKey = guardCancel(
    await text({
      message: "Ghost Content API Key",
      initialValue: existingEnv.GHOST_CONTENT_API_KEY ?? existingConfig.contentApiKey,
      placeholder: "Paste Content API Key (read-only)",
      validate: (value) => (value?.trim() ? undefined : "Required"),
    }),
    runtime,
  );

  const adminApiKey = guardCancel(
    await text({
      message: "Ghost Admin API Key (id:secret)",
      initialValue: existingEnv.GHOST_ADMIN_API_KEY ?? existingConfig.adminApiKey,
      placeholder: "Paste Admin API Key (management)",
      validate: (value) => (value?.trim() ? undefined : "Required"),
    }),
    runtime,
  );

  const nextSkills = { ...nextConfig.skills };
  const nextEntries = { ...nextSkills.entries };

  nextEntries["ghost"] = {
    ...(nextEntries["ghost"] as Record<string, unknown> | undefined),
    env: {
      GHOST_API_URL: String(apiUrl).trim(),
      GHOST_CONTENT_API_KEY: String(contentApiKey).trim(),
      GHOST_ADMIN_API_KEY: String(adminApiKey).trim(),
    },
  };

  return {
    ...nextConfig,
    skills: {
      ...nextSkills,
      entries: nextEntries,
    },
  };
}
