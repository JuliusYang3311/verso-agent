#!/usr/bin/env tsx
/**
 * Copy factor-space.json from src/memory to dist/memory
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const src = path.join(projectRoot, "src", "memory", "factor-space.json");
const distDir = path.join(projectRoot, "dist", "memory");
const dest = path.join(distDir, "factor-space.json");

if (!fs.existsSync(src)) {
  console.warn("[copy-factor-space] factor-space.json not found at", src);
  process.exit(0);
}

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.copyFileSync(src, dest);
console.log("[copy-factor-space] Copied factor-space.json to dist/memory");
