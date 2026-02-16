import type { Command } from "commander";
import * as p from "@clack/prompts";
import { exchangeCodeForTokens, getGoogleAuthUrl } from "../agents/google-auth.js";

export function registerGoogleCli(program: Command) {
  const google = program.command("google").description("Google Workspace tools");

  google
    .command("auth")
    .description("Complete Google OAuth authentication")
    .option("-c, --code <code>", "The authentication code from Google")
    .action(async (options) => {
      let code = options.code;

      if (!code) {
        try {
          const authUrl = await getGoogleAuthUrl();
          p.log.info("Google Workspace authentication required.");
          p.log.info(`Please visit this URL to authorize:\n\n  ${authUrl}\n`);
          p.log.info(
            "After authorizing, you will be redirected to a 'localhost' page that might fail to load.",
          );
          p.log.info("Copy the 'code' parameter from the address bar (e.g., ?code=4/0Af...).");
        } catch (err) {
          p.log.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }

        const input = await p.text({
          message: "Paste the authorization code here:",
          validate: (value) => {
            if (!value.trim()) {
              return "Code is required";
            }
            return;
          },
        });

        if (p.isCancel(input)) {
          p.log.warn("Auth setup cancelled.");
          process.exit(0);
        }

        code = input;
      }

      const spin = p.spinner();
      spin.start("Exchanging code for tokens...");
      try {
        await exchangeCodeForTokens(code);
        spin.stop("Successfully authenticated with Google Workspace!");
      } catch (error) {
        spin.stop("Authentication failed");
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
