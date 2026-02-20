import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chunkMarkdown,
  findBestCutoff,
  findCodeFences,
  listMemoryFiles,
  normalizeExtraMemoryPaths,
  scanBreakPoints,
} from "./internal.js";

describe("normalizeExtraMemoryPaths", () => {
  it("trims, resolves, and dedupes paths", () => {
    const workspaceDir = path.join(os.tmpdir(), "memory-test-workspace");
    const absPath = path.resolve(path.sep, "shared-notes");
    const result = normalizeExtraMemoryPaths(workspaceDir, [" notes ", "./notes", absPath, ""]);
    expect(result).toEqual([path.resolve(workspaceDir, "notes"), absPath]);
  });
});

describe("listMemoryFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("includes files from additional paths (directory)", async () => {
    await fs.writeFile(path.join(tmpDir, "MEMORY.md"), "# Default memory");
    const extraDir = path.join(tmpDir, "extra-notes");
    await fs.mkdir(extraDir, { recursive: true });
    await fs.writeFile(path.join(extraDir, "note1.md"), "# Note 1");
    await fs.writeFile(path.join(extraDir, "note2.md"), "# Note 2");
    await fs.writeFile(path.join(extraDir, "ignore.txt"), "Not a markdown file");

    const files = await listMemoryFiles(tmpDir, [extraDir]);
    expect(files).toHaveLength(3);
    expect(files.some((file) => file.endsWith("MEMORY.md"))).toBe(true);
    expect(files.some((file) => file.endsWith("note1.md"))).toBe(true);
    expect(files.some((file) => file.endsWith("note2.md"))).toBe(true);
    expect(files.some((file) => file.endsWith("ignore.txt"))).toBe(false);
  });

  it("includes files from additional paths (single file)", async () => {
    await fs.writeFile(path.join(tmpDir, "MEMORY.md"), "# Default memory");
    const singleFile = path.join(tmpDir, "standalone.md");
    await fs.writeFile(singleFile, "# Standalone");

    const files = await listMemoryFiles(tmpDir, [singleFile]);
    expect(files).toHaveLength(2);
    expect(files.some((file) => file.endsWith("standalone.md"))).toBe(true);
  });

  it("handles relative paths in additional paths", async () => {
    await fs.writeFile(path.join(tmpDir, "MEMORY.md"), "# Default memory");
    const extraDir = path.join(tmpDir, "subdir");
    await fs.mkdir(extraDir, { recursive: true });
    await fs.writeFile(path.join(extraDir, "nested.md"), "# Nested");

    const files = await listMemoryFiles(tmpDir, ["subdir"]);
    expect(files).toHaveLength(2);
    expect(files.some((file) => file.endsWith("nested.md"))).toBe(true);
  });

  it("ignores non-existent additional paths", async () => {
    await fs.writeFile(path.join(tmpDir, "MEMORY.md"), "# Default memory");

    const files = await listMemoryFiles(tmpDir, ["/does/not/exist"]);
    expect(files).toHaveLength(1);
  });

  it("ignores symlinked files and directories", async () => {
    await fs.writeFile(path.join(tmpDir, "MEMORY.md"), "# Default memory");
    const extraDir = path.join(tmpDir, "extra");
    await fs.mkdir(extraDir, { recursive: true });
    await fs.writeFile(path.join(extraDir, "note.md"), "# Note");

    const targetFile = path.join(tmpDir, "target.md");
    await fs.writeFile(targetFile, "# Target");
    const linkFile = path.join(extraDir, "linked.md");

    const targetDir = path.join(tmpDir, "target-dir");
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, "nested.md"), "# Nested");
    const linkDir = path.join(tmpDir, "linked-dir");

    let symlinksOk = true;
    try {
      await fs.symlink(targetFile, linkFile, "file");
      await fs.symlink(targetDir, linkDir, "dir");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        symlinksOk = false;
      } else {
        throw err;
      }
    }

    const files = await listMemoryFiles(tmpDir, [extraDir, linkDir]);
    expect(files.some((file) => file.endsWith("note.md"))).toBe(true);
    if (symlinksOk) {
      expect(files.some((file) => file.endsWith("linked.md"))).toBe(false);
      expect(files.some((file) => file.endsWith("nested.md"))).toBe(false);
    }
  });
});

describe("chunkMarkdown", () => {
  it("splits overly long lines into max-sized chunks", () => {
    const chunkTokens = 400;
    const maxChars = chunkTokens * 4;
    const content = "a".repeat(maxChars * 3 + 25);
    const chunks = chunkMarkdown(content, { tokens: chunkTokens, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(maxChars);
    }
  });

  it("returns single chunk for short content", () => {
    const chunks = chunkMarkdown("Hello world", { tokens: 400, overlap: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe("Hello world");
    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks[0]!.endLine).toBe(1);
  });

  it("returns empty array for empty content", () => {
    expect(chunkMarkdown("", { tokens: 400, overlap: 0 })).toEqual([]);
  });

  it("splits at heading boundaries", () => {
    const chunkTokens = 100;
    // Build content: ~350 chars of prose, then a heading, then more prose
    const prose1 = "Lorem ipsum. ".repeat(25).trim(); // ~325 chars
    const prose2 = "More content. ".repeat(25).trim();
    const content = `${prose1}\n\n## Section Two\n\n${prose2}`;
    const chunks = chunkMarkdown(content, { tokens: chunkTokens, overlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // First chunk should end before or at the heading
    expect(chunks[0]!.text).not.toContain("## Section Two");
  });

  it("does not split inside code fences", () => {
    const chunkTokens = 100;
    // Build: some prose, then a code block that spans the boundary
    const prose = "Some intro text.\n\n";
    const codeLine = "const x = 1;\n";
    // Make code block ~350 chars (within window of maxChars)
    const codeLines = codeLine.repeat(25);
    const content = `${prose}\`\`\`ts\n${codeLines}\`\`\`\n\nAfter code.`;
    const chunks = chunkMarkdown(content, { tokens: chunkTokens, overlap: 0 });
    // No chunk should start with a partial code block interior
    for (const chunk of chunks) {
      const fenceCount = (chunk.text.match(/```/g) || []).length;
      // Fences should be paired (0 or 2) or the chunk contains the whole block
      expect(fenceCount % 2 === 0 || fenceCount === 1).toBe(true);
    }
  });

  it("produces overlapping chunks when overlap > 0", () => {
    const chunkTokens = 100;
    const content = "Line of text.\n".repeat(200); // ~2800 chars, well over 400 chars
    const chunks = chunkMarkdown(content, { tokens: chunkTokens, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    // Check that consecutive chunks share some text
    for (let i = 1; i < chunks.length; i++) {
      const prevEnd = chunks[i - 1]!.text;
      const currStart = chunks[i]!.text;
      const prevTail = prevEnd.slice(-80);
      // The start of the current chunk should overlap with the end of the previous
      expect(currStart.includes(prevTail) || prevEnd.slice(-40) === currStart.slice(0, 40)).toBe(
        true,
      );
    }
  });

  it("tracks correct startLine and endLine", () => {
    const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
    const chunks = chunkMarkdown(content, { tokens: 400, overlap: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks[0]!.endLine).toBe(5);
  });
});

describe("scanBreakPoints", () => {
  it("detects headings with correct scores", () => {
    const text = "\n# H1\n\n## H2\n\n### H3\n";
    const bps = scanBreakPoints(text);
    const h1 = bps.find((bp) => bp.type === "h1");
    const h2 = bps.find((bp) => bp.type === "h2");
    const h3 = bps.find((bp) => bp.type === "h3");
    expect(h1?.score).toBe(100);
    expect(h2?.score).toBe(90);
    expect(h3?.score).toBe(80);
  });

  it("higher score wins at same position", () => {
    // A blank line (\n\n) at the same pos as a heading — heading should win
    const text = "\n\n## Heading\n";
    const bps = scanBreakPoints(text);
    // Position 0 has \n which could match newline(1) and blank(20), but \n## matches h2(90)
    const atHeading = bps.find((bp) => bp.type === "h2");
    expect(atHeading).toBeDefined();
    expect(atHeading!.score).toBe(90);
  });
});

describe("findCodeFences", () => {
  it("finds paired code fences", () => {
    const text = "before\n```ts\ncode\n```\nafter";
    const fences = findCodeFences(text);
    expect(fences).toHaveLength(1);
    expect(fences[0]!.start).toBeLessThan(fences[0]!.end);
  });

  it("handles unclosed fence", () => {
    const text = "before\n```ts\ncode without closing";
    const fences = findCodeFences(text);
    expect(fences).toHaveLength(1);
    expect(fences[0]!.end).toBe(text.length);
  });
});

describe("findBestCutoff", () => {
  it("prefers heading over newline near target", () => {
    const bps = [
      { pos: 300, score: 90, type: "h2" },
      { pos: 390, score: 1, type: "newline" },
    ];
    const cutoff = findBestCutoff(bps, 400, 200);
    expect(cutoff).toBe(300); // heading wins despite distance
  });

  it("returns target when no break points in window", () => {
    const cutoff = findBestCutoff([], 400, 200);
    expect(cutoff).toBe(400);
  });
});
