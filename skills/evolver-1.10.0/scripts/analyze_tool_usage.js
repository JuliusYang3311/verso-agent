#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function usage() {
  console.log("Usage: node scripts/analyze_tool_usage.js <input-file> [--top=10] [--json]");
}

function parseArgs(argv) {
  const args = { input: null, top: 10, json: false };
  for (const arg of argv) {
    if (!arg.startsWith("--") && !args.input) {
      args.input = arg;
      continue;
    }
    if (arg.startsWith("--top=")) {
      const n = Number.parseInt(arg.slice("--top=".length), 10);
      if (Number.isFinite(n) && n > 0) args.top = n;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
  }
  return args;
}

function collectToolMarkers(text) {
  // Matches formats like:
  // [TOOL: exec]
  // **ASSISTANT**: [TOOL: process]
  const markerRegex = /\[TOOL:\s*([^\]]+)\]/g;
  const counts = new Map();
  let m;
  while ((m = markerRegex.exec(text)) !== null) {
    const name = String(m[1] || "").trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return counts;
}

function toSortedRows(counts) {
  return Array.from(counts.entries())
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    usage();
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), args.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(2);
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  const counts = collectToolMarkers(raw);
  const rows = toSortedRows(counts);
  const topRows = rows.slice(0, args.top);

  const output = {
    file: inputPath,
    total_markers: rows.reduce((sum, r) => sum + r.count, 0),
    unique_tools: rows.length,
    top: topRows,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Tool usage summary for: ${inputPath}`);
  console.log(`Total markers: ${output.total_markers}`);
  console.log(`Unique tools: ${output.unique_tools}`);
  for (const row of topRows) {
    console.log(`- ${row.tool}: ${row.count}`);
  }
}

if (require.main === module) {
  main();
}
