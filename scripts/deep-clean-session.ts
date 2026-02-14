import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Hardcoded path to the main session file found via sessions.json
const SESSION_FILE_PATH = path.join(
  os.homedir(),
  ".verso/agents/main/sessions/eed60fcf-cc51-4c7b-a45c-4ea9ae2b64d1.jsonl",
);

async function main() {
  const targetFile = process.argv[2] || SESSION_FILE_PATH;
  console.log(`Deep cleaning session file: ${targetFile}`);

  if (!fs.existsSync(targetFile)) {
    console.error(`File not found: ${targetFile}`);
    process.exit(1);
  }

  try {
    // 1. Read line-by-line (JSONL)
    const raw = fs.readFileSync(targetFile, "utf-8");
    const lines = raw.split(/\r?\n/);

    console.log(`Found ${lines.length} lines.`);

    let processedLines: string[] = [];
    let droppedCount = 0;

    for (const line of lines) {
      if (!line.trim()) {
        // Keep empty lines? Usually better to trim trailing newlines in array and join later.
        continue;
      }

      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch (e) {
        console.warn("Skipping invalid JSON line:", line.slice(0, 50));
        continue;
      }

      if (entry.type === "message" && entry.data) {
        const msg = entry.data;

        // Check for error/aborted stop reasons
        const stopReason = msg.stopReason;
        if (stopReason === "error" || stopReason === "aborted") {
          // Log details about what we are dropping
          const timestamp = msg.timestamp ? new Date(msg.timestamp).toISOString() : "unknown time";
          console.log(
            `[Clean] Dropping aborted message at ${timestamp} (stopReason=${stopReason})`,
          );

          // Check if it has tool use
          const hasToolUse =
            Array.isArray(msg.content) &&
            msg.content.some((c: any) => c.type === "toolUse" || c.type === "toolCall");
          if (hasToolUse) {
            console.log("       -> Confirmed incomplete tool call present.");
          }

          droppedCount++;
          continue; // DROP THIS LINE
        }
      }

      // Keep the line (push original string or re-stringify?)
      // Re-stringify ensures valid JSON if we modified it (we didn't yet),
      // but keeping original is safer to preserve exact formatting if we were just filtering.
      // However, since we parsed it, we might as well push the original line string associated with this entry
      // to avoid serialization artifacts (though we haven't mapped `indices`).
      // Actually simpler: just re-push `line`.
      processedLines.push(line);
    }

    console.log(`Dropped ${droppedCount} incomplete messages.`);

    if (droppedCount === 0) {
      console.log("No incomplete messages found. File is clean.");
      // We can exit, but let's write it anyway to ensure consistency if we added other logic later.
      // Actually if 0 dropped, we don't need to touch the file.
      return;
    }

    // 3. Backup
    const backupPath = targetFile + ".clean.bak";
    fs.writeFileSync(backupPath, raw);
    console.log(`Backup saved to: ${backupPath}`);

    // 4. Save
    // JSONL: join with newlines
    const newContent = processedLines.join("\n");
    // Ensure trailing newline
    const finalContent = newContent + "\n";

    fs.writeFileSync(targetFile, finalContent);
    console.log(`Cleaned session saved to: ${targetFile}`);
  } catch (e) {
    console.error("Error processing session file:", e);
    process.exit(1);
  }
}

main();
