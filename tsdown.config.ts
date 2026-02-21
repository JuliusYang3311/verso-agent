import { defineConfig } from "tsdown";

const env = {
  NODE_ENV: "production",
};

export default defineConfig([
  {
    entry: "src/index.ts",
    env,
    fixedExtension: false,
    platform: "node",
  },
  {
    entry: "src/entry.ts",
    env,
    fixedExtension: false,
    platform: "node",
  },
  {
    entry: "src/infra/warning-filter.ts",
    env,
    fixedExtension: false,
    platform: "node",
  },
  {
    entry: "src/plugin-sdk/index.ts",
    outDir: "dist/plugin-sdk",
    env,
    fixedExtension: false,
    platform: "node",
  },
  {
    entry: "src/extensionAPI.ts",
    env,
    fixedExtension: false,
    platform: "node",
  },
  {
    entry: ["src/hooks/bundled/*/handler.ts", "src/hooks/llm-slug-generator.ts"],
    env,
    fixedExtension: false,
    platform: "node",
  },
  {
    entry: [
      "src/evolver/daemon-entry.ts",
      "src/evolver/sandbox-agent.ts",
      "src/evolver/evolve.ts",
      "src/evolver/evolver-review.ts",
      "src/evolver/gep/sandbox-runner.ts",
      "src/evolver/gep/solidify.ts",
    ],
    outDir: "dist/evolver",
    env,
    fixedExtension: false,
    platform: "node",
  },
]);
