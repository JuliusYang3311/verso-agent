import type { Command } from "commander";
import { exchangeCodeForTokens } from "../agents/google-auth.js";

export function registerGoogleCli(program: Command) {
  const google = program.command("google").description("Google Workspace tools");

  google
    .command("auth")
    .description("Complete Google OAuth authentication")
    .option("-c, --code <code>", "The authentication code from Google")
    .action(async (options) => {
      let code = options.code;

      if (!code) {
        console.log("Please provide the code from the Google authorization page.");
        console.log(
          "If you were redirected to localhost and got an error page, copy the 'code' parameter from the address bar.",
        );
        process.exit(1);
      }

      try {
        await exchangeCodeForTokens(code);
        console.log("Successfully authenticated with Google Workspace!");
      } catch (error) {
        console.error("Authentication failed:", error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
