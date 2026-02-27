#!/usr/bin/env npx tsx
/**
 * write-chapter.ts
 * Autonomous novel-writing engine.
 * Two modes:
 *   - write: auto-detect next chapter, write, extract updates, apply patch
 *   - rewrite: revert memory for chapter N, rewrite, re-apply patch
 *
 * Usage:
 *   node dist/skills/novel-writer/write-chapter.js \
 *     --project my_novel --outline "林澈在旧港码头发现暗门"
 *
 *   node dist/skills/novel-writer/write-chapter.js \
 *     --project my_novel --rewrite --chapter 8 --notes "节奏太慢，加强悬疑"
 */

import { type Api, completeSimple, type Model } from "@mariozechner/pi-ai";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { applyPatch, PROJECTS_DIR, loadJson, projectDir } from "./apply-patch.js";
import { assembleContext } from "./context.js";
import { extractUpdates, resolveLlmModel } from "./extract-updates.js";
import { revertChapterMemory } from "./revert-memory.js";
import { validatePatchOrThrow } from "./validate-patch.js";

type AnyObj = Record<string, any>;

export interface WriteChapterOpts {
  project: string;
  outline: string;
  title?: string;
  style?: string;
  budget?: number;
}

export interface RewriteChapterOpts {
  project: string;
  chapter: number;
  notes: string;
  style?: string;
  budget?: number;
}

export interface WriteResult {
  summary: string;
  chapterPath: string;
  wordCount: number;
  memoryUpdated: string[];
  rewritten?: boolean;
}
// --- Helpers ---

function loadState(project: string): AnyObj {
  return loadJson(path.join(PROJECTS_DIR, project, "state.json"), {}) as AnyObj;
}

function saveChapterFile(project: string, chapter: number, text: string): string {
  const chaptersDir = path.join(PROJECTS_DIR, project, "chapters");
  fsSync.mkdirSync(chaptersDir, { recursive: true });
  const fileName = `${project}_chapter_${String(chapter).padStart(2, "0")}.txt`;
  const filePath = path.join(chaptersDir, fileName);
  fsSync.writeFileSync(filePath, text, "utf-8");
  return filePath;
}

function readChapterFile(project: string, chapter: number): string | null {
  const fileName = `${project}_chapter_${String(chapter).padStart(2, "0")}.txt`;
  const filePath = path.join(PROJECTS_DIR, project, "chapters", fileName);
  if (!fsSync.existsSync(filePath)) return null;
  return fsSync.readFileSync(filePath, "utf-8");
}

function loadRules(project: string): string {
  const rulesPath = path.join(PROJECTS_DIR, project, "RULES.md");
  if (!fsSync.existsSync(rulesPath)) return "";
  return fsSync.readFileSync(rulesPath, "utf-8");
}

function summarizeMemoryChanges(patch: AnyObj): string[] {
  const changes: string[] = [];
  for (const c of (patch.characters?.add ?? []) as AnyObj[]) {
    changes.push(`新角色: ${c.name ?? "unknown"}`);
  }
  for (const t of (patch.plot_threads?.add ?? []) as AnyObj[]) {
    changes.push(`伏笔: ${t.title ?? t.thread_id ?? "unknown"}`);
  }
  if (patch.timeline?.summary) {
    changes.push(`摘要: ${String(patch.timeline.summary).slice(0, 80)}`);
  }
  return changes;
}

// --- Prompt builders ---

function buildWritingPrompt(context: AnyObj, opts: { outline: string; title?: string }): string {
  const parts: string[] = [];
  parts.push(
    "You are a professional fiction writer. Based on the memory bank and outline below, write a complete chapter.",
  );
  parts.push(
    "IMPORTANT: Write in the SAME LANGUAGE as the outline. Match the language of the provided outline exactly.",
  );
  parts.push("");

  if (context.characters) {
    parts.push("## Characters");
    parts.push(JSON.stringify(context.characters, null, 2));
    parts.push("");
  }
  if (context.world_bible) {
    parts.push("## World Bible");
    parts.push(JSON.stringify(context.world_bible, null, 2));
    parts.push("");
  }
  if (context.plot_threads) {
    parts.push("## Plot Threads & Foreshadowing");
    parts.push(JSON.stringify(context.plot_threads, null, 2));
    parts.push("");
  }
  if (context.timeline_recent?.length) {
    parts.push("## Recent Timeline (Previous Chapters)");
    parts.push(JSON.stringify(context.timeline_recent, null, 2));
    parts.push("");
  }
  if (context.style_snippets?.length) {
    parts.push("## Style Reference");
    for (const s of context.style_snippets as AnyObj[]) {
      parts.push(`- ${s.text}`);
    }
    parts.push("");
  }
  if (context.default_style && Object.keys(context.default_style).length) {
    parts.push("## Default Style");
    parts.push(JSON.stringify(context.default_style, null, 2));
    parts.push("");
  }

  const rules = loadRules(String(context.project ?? ""));
  if (rules) {
    parts.push("## Project Rules");
    parts.push(rules);
    parts.push("");
  }

  parts.push("## Writing Requirements");
  parts.push("- Output the chapter text directly, no title, chapter number, or metadata");
  parts.push("- Final output MUST exceed 10000 tokens");
  parts.push("- Keep character personalities consistent, follow world-building rules");
  parts.push("- Advance foreshadowing, create suspense");
  parts.push("- Write in the SAME LANGUAGE as the outline");
  parts.push("");
  parts.push(`## Chapter Outline\n${opts.outline}`);
  if (opts.title) parts.push(`\n## Chapter Title\n${opts.title}`);

  return parts.join("\n");
}

function buildRewritePrompt(context: AnyObj, originalText: string, notes: string): string {
  const base = buildWritingPrompt(context, { outline: notes });
  const extra = [
    "",
    "## Rewrite Mode",
    "Below is the original chapter. Rewrite it based on the rewrite notes.",
    "Write in the SAME LANGUAGE as the original chapter. Output MUST exceed 10000 tokens.",
    "",
    "### Rewrite Notes",
    notes,
    "",
    "### Original Text",
    originalText,
  ];
  return base + "\n" + extra.join("\n");
}

async function generateChapter(
  model: Model<Api>,
  apiKey: string,
  systemPrompt: string,
): Promise<string> {
  const res = await completeSimple(
    model,
    {
      systemPrompt,
      messages: [
        {
          role: "user",
          content: "Begin writing now. Output the chapter text directly, no preamble.",
          timestamp: Date.now(),
        },
      ],
    },
    { apiKey, maxTokens: 16384 },
  );

  let text = res.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Continuation if output is too short (10000+ tokens required ≈ 10000+ chars)
  // Note: systemPrompt already contains full memory context (characters, world_bible,
  // plot_threads, timeline, style), so the continuation has access to all memory.
  if (text.length < 10000) {
    const contPrompt = `Here is what has been written so far. Continue writing from where it left off. Do NOT repeat any existing content:\n\n---\n${text}\n---\n\nContinue directly.`;
    const cont = await completeSimple(
      model,
      {
        systemPrompt,
        messages: [{ role: "user", content: contPrompt, timestamp: Date.now() }],
      },
      { apiKey, maxTokens: 16384 },
    );
    text += cont.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  }

  return text.trim();
}

// --- Exported API ---

export async function writeChapter(opts: WriteChapterOpts): Promise<WriteResult> {
  const { project, outline, style, budget } = opts;

  // Auto-detect next chapter number
  const state = loadState(project);
  const chapter = ((state.last_chapter as number) ?? 0) + 1;
  const title = opts.title ?? `第${chapter}章`;

  // Ensure project dirs exist
  projectDir(project);

  // 1. Assemble context (memory + style + timeline)
  const context = await assembleContext({ project, outline, style, budget: budget ?? 8000 });

  // 2. Build writing prompt
  const systemPrompt = buildWritingPrompt(context, { outline, title });

  // 3. Call LLM to write chapter
  const { model, apiKey } = await resolveLlmModel();
  const chapterText = await generateChapter(model, apiKey, systemPrompt);

  // 4. Save chapter as .txt
  const chapterPath = saveChapterFile(project, chapter, chapterText);

  // 5. Extract memory updates → validate → apply
  const patch = await extractUpdates({ chapter, title, chapterText });
  validatePatchOrThrow({ project, patch });
  await applyPatch({ project, patch, chapter, title });

  return {
    summary: (patch as AnyObj).timeline?.summary ?? "",
    chapterPath,
    wordCount: chapterText.length,
    memoryUpdated: summarizeMemoryChanges(patch as AnyObj),
  };
}

export async function rewriteChapter(opts: RewriteChapterOpts): Promise<WriteResult> {
  const { project, chapter, notes, style, budget } = opts;

  // 1. Read original chapter
  const originalText = readChapterFile(project, chapter);
  if (!originalText) throw new Error(`Chapter ${chapter} not found`);

  // 2. Revert memory changes for this chapter
  await revertChapterMemory(project, chapter);

  // 3. Assemble context (memory is now reverted to pre-chapter state)
  const context = await assembleContext({ project, outline: notes, style, budget: budget ?? 8000 });

  // 4. Build rewrite prompt
  const systemPrompt = buildRewritePrompt(context, originalText, notes);

  // 5. Call LLM to rewrite
  const { model, apiKey } = await resolveLlmModel();
  const newText = await generateChapter(model, apiKey, systemPrompt);

  // 6. Overwrite chapter file
  const chapterPath = saveChapterFile(project, chapter, newText);

  // 7. Extract updates → validate → apply (fresh patch for rewritten chapter)
  const state = loadState(project);
  const title =
    (state.chapters_written as AnyObj[])?.find((w) => w.chapter === chapter)?.title ??
    `第${chapter}章`;
  const patch = await extractUpdates({ chapter, title, chapterText: newText });
  validatePatchOrThrow({ project, patch });
  await applyPatch({ project, patch, chapter, title });

  return {
    summary: (patch as AnyObj).timeline?.summary ?? "",
    chapterPath,
    wordCount: newText.length,
    memoryUpdated: summarizeMemoryChanges(patch as AnyObj),
    rewritten: true,
  };
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      project: { type: "string" },
      outline: { type: "string", default: "" },
      title: { type: "string", default: "" },
      style: { type: "string", default: "" },
      budget: { type: "string", default: "" },
      rewrite: { type: "boolean", default: false },
      chapter: { type: "string", default: "" },
      notes: { type: "string", default: "" },
    },
    strict: true,
  });

  if (!values.project) {
    console.error("--project is required");
    process.exit(1);
  }

  const budget = values.budget ? parseInt(values.budget, 10) : undefined;

  const run = values.rewrite
    ? rewriteChapter({
        project: values.project,
        chapter: parseInt(values.chapter!, 10),
        notes: values.notes || values.outline || "",
        style: values.style || undefined,
        budget,
      })
    : writeChapter({
        project: values.project,
        outline: values.outline || "",
        title: values.title || undefined,
        style: values.style || undefined,
        budget,
      });

  run
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
