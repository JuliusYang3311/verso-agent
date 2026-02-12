import { loadSessionStore, removeSessionFromStore } from "../config/sessions.js";
import { isSubagentSessionKey } from "../routing/session-key.js";

async function cleanup() {
  const stateDir = "/Users/veso/.verso"; // Hardcoded for this environment.

  // Find all sessions.json files
  const findCmd = `find ${stateDir} -name "sessions.json"`;
  const { execSync } = await import("node:child_process");
  const storePaths = execSync(findCmd).toString().split("\n").filter(Boolean);

  console.log(`Found ${storePaths.length} session stores.`);

  for (const storePath of storePaths) {
    console.log(`\nProcessing store: ${storePath}`);
    const store = loadSessionStore(storePath);
    const keys = Object.keys(store);
    let removedCount = 0;

    for (const key of keys) {
      console.log(`    Key: ${key}`);
      const isSubagent =
        isSubagentSessionKey(key) || key.includes("-subagent-") || key.includes(":subagent:");
      const isCron = key.startsWith("cron:") || key.includes(":cron:");

      let shouldRemove = isSubagent || isCron;

      if (!shouldRemove) {
        // deep scan: check if entry has spawnedBy
        const entry = store[key];
        if (entry && entry.spawnedBy) {
          shouldRemove = true;
        }
      }

      if (shouldRemove) {
        console.log(`  Removing stale session: ${key}`);
        await removeSessionFromStore({ storePath, sessionKey: key });
        removedCount++;
      }
    }
    console.log(`  Removed ${removedCount} sessions.`);
  }

  console.log("\nCleanup finished!");
}

cleanup().catch(console.error);
