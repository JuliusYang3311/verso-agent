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
 *     --project my_novel --outline "The hero discovers a hidden door at the old harbor"
 *
 *   node dist/skills/novel-writer/write-chapter.js \
 *     --project my_novel --rewrite --chapter 8 --notes "Pacing too slow, increase suspense"
 */

import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  applyPatch,
  PROJECTS_DIR,
  loadJson,
  saveJson,
  projectDir,
  memPath,
} from "./apply-patch.js";
import { assembleContext } from "./context.js";
import {
  extractUpdates,
  novelComplete,
  resolveLlmModel,
  safeParseJson,
  type ResolvedLlm,
} from "./extract-updates.js";
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
    changes.push(`new character: ${c.name ?? "unknown"}`);
  }
  for (const t of (patch.plot_threads?.add ?? []) as AnyObj[]) {
    changes.push(`plot thread: ${t.title ?? t.thread_id ?? "unknown"}`);
  }
  if (patch.timeline?.summary) {
    changes.push(`summary: ${String(patch.timeline.summary)}`);
  }
  return changes;
}

// --- Prompt builders ---

// --- Step 0: Initialize project memory from outline ---

async function initProjectMemory(
  project: string,
  outline: string,
  llm: ResolvedLlm,
): Promise<string[]> {
  const systemPrompt = [
    "You are a fiction planning assistant. Given a novel outline/synopsis, extract the initial story setup as JSON.",
    "Write in the SAME LANGUAGE as the outline.",
    "Output ONLY valid JSON with these keys:",
    "",
    "characters: { characters: [{ name, aliases?, role (main/support/minor), traits: [], status, relations?: {}, protected?: true }] }",
    "world_bible: { world: { rules?: [], locations?: [], organizations?: [], ... }, protected_keys: [] }",
    "plot_threads: { threads: [{ thread_id, introduced_in: 0, promise, stakes, status: 'open', must_resolve_by?, notes? }] }",
    "timeline: { summary: '<one-line synopsis>', events: [], consequences: [], pov: '', locations: [], characters: [] }",
    "",
    "Guidelines:",
    "- Mark protagonist(s) as role: 'main' and protected: true",
    "- Add core world rules to protected_keys",
    "- Create plot threads for major story arcs mentioned in the outline",
    "- thread_id format: t-<short-kebab-case>",
    "- introduced_in: 0 means established before chapter 1",
    "- timeline.summary should be a one-line synopsis of the entire story premise",
  ].join("\n");

  const res = await novelComplete(llm, {
    systemPrompt,
    messages: [{ role: "user", content: outline, timestamp: Date.now() }],
  });

  const rawText = res.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  console.error(`[initProjectMemory] LLM returned ${rawText.length} chars`);
  if (rawText.length < 10) {
    console.error(`[initProjectMemory] LLM output too short, raw: ${rawText}`);
  }

  const init = safeParseJson(rawText) as AnyObj;
  console.error(`[initProjectMemory] Parsed keys: ${Object.keys(init).join(", ")}`);
  const changes: string[] = [];

  // Save characters
  if (init.characters?.characters?.length) {
    saveJson(memPath(project, "characters.json"), { characters: init.characters.characters });
    changes.push(`characters: ${init.characters.characters.map((c: AnyObj) => c.name).join(", ")}`);
  } else {
    saveJson(memPath(project, "characters.json"), { characters: [] });
  }

  // Save world bible
  if (init.world_bible?.world) {
    saveJson(memPath(project, "world_bible.json"), {
      world: init.world_bible.world,
      protected_keys: init.world_bible.protected_keys ?? [],
    });
    const keys = Object.keys(init.world_bible.world);
    if (keys.length) changes.push(`world: ${keys.join(", ")}`);
  } else {
    saveJson(memPath(project, "world_bible.json"), { world: {}, protected_keys: [] });
  }

  // Save plot threads
  if (init.plot_threads?.threads?.length) {
    saveJson(memPath(project, "plot_threads.json"), { threads: init.plot_threads.threads });
    changes.push(
      `threads: ${init.plot_threads.threads.map((t: AnyObj) => t.promise ?? t.thread_id).join(", ")}`,
    );
  } else {
    saveJson(memPath(project, "plot_threads.json"), { threads: [] });
  }

  // Save initial timeline entry (chapter 0 = premise)
  {
    const tl = init.timeline ?? {};
    const summary = tl.summary ?? outline;
    const entry = {
      chapter: 0,
      title: "premise",
      summary,
      events: tl.events ?? [],
      consequences: tl.consequences ?? [],
      pov: tl.pov ?? "",
      locations: tl.locations ?? [],
      characters: tl.characters ?? [],
      updated_at: new Date().toISOString().replace("T", " "),
    };
    const tlPath = memPath(project, "timeline.jsonl");
    fsSync.mkdirSync(path.dirname(tlPath), { recursive: true });
    fsSync.writeFileSync(tlPath, JSON.stringify(entry) + "\n", "utf-8");
    changes.push(`premise: ${String(summary)}`);
  }

  return changes;
}

// --- Prompt builders (chapter writing) ---

function buildWritingPrompt(context: AnyObj, opts: { outline: string; title?: string }): string {
  const parts: string[] = [];
  parts.push(
    "You are a professional fiction writer. Based on the memory bank and outline below, write a complete chapter.",
  );
  parts.push(
    "IMPORTANT: Write in the SAME LANGUAGE as the outline. Match the language of the provided outline exactly.",
  );
  parts.push(
    "CRITICAL: You are NOT an AI assistant or coding agent. You have NO tools. Do NOT output XML tags, function calls, tool_call blocks, or any markup. Output ONLY the raw chapter text as plain prose.",
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
  parts.push("- Final output MUST exceed 8000 tokens");
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
    "Write in the SAME LANGUAGE as the original chapter. Output MUST exceed 8000 tokens.",
    "",
    "### Rewrite Notes",
    notes,
    "",
    "### Original Text",
    originalText,
  ];
  return base + "\n" + extra.join("\n");
}

async function generateChapter(llm: ResolvedLlm, systemPrompt: string): Promise<string> {
  const res = await novelComplete(llm, {
    systemPrompt,
    messages: [
      {
        role: "user",
        content: "Begin writing now. Output the chapter text directly, no preamble.",
        timestamp: Date.now(),
      },
    ],
  });

  let text = res.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Continuation if output is too short (8000+ tokens required ≈ 8000+ chars)
  // Note: systemPrompt already contains full memory context (characters, world_bible,
  // plot_threads, timeline, style), so the continuation has access to all memory.
  if (text.length < 8000) {
    const contPrompt = `Here is what has been written so far. Continue writing from where it left off. Do NOT repeat any existing content:\n\n---\n${text}\n---\n\nContinue directly.`;
    const cont = await novelComplete(llm, {
      systemPrompt,
      messages: [{ role: "user", content: contPrompt, timestamp: Date.now() }],
    });
    text += cont.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  }

  return sanitizeChapterText(text);
}

/** Strip tool-call / agent artifacts that LLMs sometimes emit. */
function sanitizeChapterText(raw: string): string {
  let s = raw;
  // Remove <tool_call>...</tool_call>, <function_calls>...</function_calls>, <invoke>...</invoke>
  s = s.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "");
  s = s.replace(/<function_calls>[\s\S]*?<\/function_calls>/g, "");
  s = s.replace(/<\/?invoke[^>]*>/g, "");
  s = s.replace(/<\/?parameter[^>]*>/g, "");
  // Remove ```...``` code fences wrapping the entire output
  s = s.replace(/^```(?:text|markdown)?\s*\n?([\s\S]*?)\n?\s*```$/g, "$1");
  // Remove stray agent preamble lines
  s = s.replace(/^(?:创作中\.\.\.|Let me write.*|I will write.*|Here is the chapter.*)\n*/gim, "");
  return s.trim();
}

// --- Exported API ---

export async function writeChapter(opts: WriteChapterOpts): Promise<WriteResult> {
  const { project, outline, style, budget } = opts;

  // Auto-detect next chapter number
  const state = loadState(project);
  const chapter = ((state.last_chapter as number) ?? 0) + 1;
  const title = opts.title ?? `Chapter ${chapter}`;

  // Ensure project dirs exist
  projectDir(project);

  // 0. Initialize memory if this is a new project (project memory dir doesn't exist)
  const llm = await resolveLlmModel();
  let initChanges: string[] = [];
  const memDir = path.join(PROJECTS_DIR, project, "memory");
  if (!fsSync.existsSync(memDir)) {
    console.error("New project detected, initializing memory from outline...");
    try {
      initChanges = await initProjectMemory(project, outline, llm);
      console.error(`Memory initialized: ${initChanges.join("; ")}`);
    } catch (err) {
      console.error(`WARNING: initProjectMemory failed, continuing without initial memory: ${err}`);
      // Ensure memory dir exists so we don't retry on next call
      fsSync.mkdirSync(memDir, { recursive: true });
    }
  }

  // 1. Assemble context (memory + style + timeline)
  const context = await assembleContext({ project, outline, style, budget: budget ?? 12000 });

  // 2. Build writing prompt
  const systemPrompt = buildWritingPrompt(context, { outline, title });

  // 3. Call LLM to write chapter
  const chapterText = await generateChapter(llm, systemPrompt);

  // 4. Save chapter as .txt
  const chapterPath = saveChapterFile(project, chapter, chapterText);

  // 5. Extract memory updates → validate → apply
  console.error(`[writeChapter] extracting updates for chapter ${chapter}...`);
  const patch = await extractUpdates({ chapter, title, chapterText, llm });
  console.error(`[writeChapter] patch keys: ${Object.keys(patch).join(", ")}`);
  validatePatchOrThrow({ project, patch });
  console.error(`[writeChapter] patch validated, applying...`);
  await applyPatch({ project, patch, chapter, title });
  console.error(`[writeChapter] patch applied successfully`);

  return {
    summary: (patch as AnyObj).timeline?.summary ?? "",
    chapterPath,
    wordCount: chapterText.length,
    memoryUpdated: [...initChanges, ...summarizeMemoryChanges(patch as AnyObj)],
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
  const context = await assembleContext({
    project,
    outline: notes,
    style,
    budget: budget ?? 12000,
  });

  // 4. Build rewrite prompt
  const systemPrompt = buildRewritePrompt(context, originalText, notes);

  // 5. Call LLM to rewrite
  const llm = await resolveLlmModel();
  const newText = await generateChapter(llm, systemPrompt);

  // 6. Overwrite chapter file
  const chapterPath = saveChapterFile(project, chapter, newText);

  // 7. Extract updates → validate → apply (fresh patch for rewritten chapter)
  const state = loadState(project);
  const title =
    (state.chapters_written as AnyObj[])?.find((w) => w.chapter === chapter)?.title ??
    `Chapter ${chapter}`;
  const patch = await extractUpdates({ chapter, title, chapterText: newText, llm });
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
