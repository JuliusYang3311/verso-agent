import fs from "node:fs";
import path from "node:path";

function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {
    // ignore
  }
}

export function clip(text: string | null | undefined, maxChars: number): string {
  const s = String(text || "");
  const n = Number(maxChars);
  if (!Number.isFinite(n) || n <= 0) {
    return s;
  }
  if (s.length <= n) {
    return s;
  }
  return s.slice(0, Math.max(0, n - 40)) + "\n...[TRUNCATED]...\n";
}

export function writePromptArtifact(params: {
  memoryDir: string;
  cycleId?: string | null;
  runId?: string | null;
  prompt?: string | null;
  meta?: Record<string, unknown> | null;
}): { promptPath: string; metaPath: string } {
  const dir = String(params.memoryDir || "").trim();
  if (!dir) {
    throw new Error("bridge: missing memoryDir");
  }
  ensureDir(dir);
  const safeCycle = String(params.cycleId || "cycle").replace(/[^a-zA-Z0-9_\-#]/g, "_");
  const safeRun = String(params.runId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "_");
  const base = `gep_prompt_${safeCycle}_${safeRun}`;
  const promptPath = path.join(dir, base + ".txt");
  const metaPath = path.join(dir, base + ".json");

  fs.writeFileSync(promptPath, String(params.prompt || ""), "utf8");
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        type: "GepPromptArtifact",
        at: new Date().toISOString(),
        cycle_id: params.cycleId || null,
        run_id: params.runId || null,
        prompt_path: promptPath,
        meta: params.meta && typeof params.meta === "object" ? params.meta : null,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  return { promptPath, metaPath };
}

export function renderSessionsSpawnCall(params: {
  task: string;
  agentId?: string;
  label?: string;
  cleanup?: string;
}): string {
  const t = String(params.task || "").trim();
  if (!t) {
    throw new Error("bridge: missing task");
  }
  const a = String(params.agentId || "main");
  const l = String(params.label || "gep_bridge");
  const c = params.cleanup ? String(params.cleanup) : "delete";

  const payload = JSON.stringify({ task: t, agentId: a, cleanup: c, label: l });
  return `sessions_spawn(${payload})`;
}
