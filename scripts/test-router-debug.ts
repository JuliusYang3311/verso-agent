import { createClassifierFn } from "../src/agents/model-router-classifier.js";
import { resolveRouterModel } from "../src/agents/model-router.js";
import { loadConfig } from "../src/config/config.js";
import { setVerbose } from "../src/globals.js";

async function main() {
  setVerbose(true); // Enable verbose logs
  console.log("Loading config...");
  const cfg = loadConfig(); // Use loadConfig
  console.log("Config loaded.");

  if (!cfg.agents?.defaults?.router?.enabled) {
    console.warn("Router is DISABLED in config.");
  } else {
    console.log("Router is ENABLED.");
    console.log("Classifier Model:", cfg.agents.defaults.router.classifierModel);
  }

  const input = "write a hello world python script";
  console.log(`Testing router with input: "${input}"`);

  const startTime = Date.now();
  try {
    const result = await resolveRouterModel({
      input,
      cfg,
      defaultProvider: "google", // assuming google default
      callClassifier: createClassifierFn(cfg, process.cwd()),
    });

    const duration = Date.now() - startTime;
    console.log(`Router completed in ${duration}ms`);
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Router FAILED:", err);
  }
}

main().catch(console.error);
