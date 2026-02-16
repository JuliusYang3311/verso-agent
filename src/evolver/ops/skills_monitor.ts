// Skills Monitor (v2.0) - Evolver Core Module
// Checks installed skills for real issues, auto-heals simple problems.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getSkillsDir, getWorkspaceRoot } from "../gep/paths.js";

const IGNORE_LIST: Set<string> = new Set([
  "common",
  "clawhub",
  "input-validator",
  "proactive-agent",
  "security-audit",
]);

// Load user-defined ignore list
try {
  const ignoreFile = path.join(getWorkspaceRoot(), ".skill_monitor_ignore");
  if (fs.existsSync(ignoreFile)) {
    fs.readFileSync(ignoreFile, "utf8")
      .split("\n")
      .forEach((l: string) => {
        const t = l.trim();
        if (t && !t.startsWith("#")) {
          IGNORE_LIST.add(t);
        }
      });
  }
} catch (_e: unknown) {
  // intentionally ignored
}

export interface SkillIssue {
  name: string;
  issues: string[];
}

export interface RunOptions {
  autoHeal?: boolean;
}

export function checkSkill(skillName: string): SkillIssue | null {
  const SKILLS_DIR = getSkillsDir();
  if (IGNORE_LIST.has(skillName)) {
    return null;
  }
  const skillPath = path.join(SKILLS_DIR, skillName);
  const issues: string[] = [];

  try {
    if (!fs.statSync(skillPath).isDirectory()) {
      return null;
    }
  } catch (_e: unknown) {
    return null;
  }

  let mainFile = "index.js";
  const pkgPath = path.join(skillPath, "package.json");
  let hasPkg = false;

  if (fs.existsSync(pkgPath)) {
    hasPkg = true;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.main) {
        mainFile = pkg.main;
      }
      if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
        if (!fs.existsSync(path.join(skillPath, "node_modules"))) {
          const entryAbs = path.join(skillPath, mainFile);
          if (fs.existsSync(entryAbs) && mainFile.endsWith(".js")) {
            try {
              execSync("node -e \"require('" + entryAbs.replace(/'/g, "\\'") + "')\"", {
                stdio: "ignore",
                timeout: 5000,
                cwd: skillPath,
              });
            } catch (_e: unknown) {
              issues.push("Missing node_modules (needs npm install)");
            }
          }
        }
      }
    } catch (_e: unknown) {
      issues.push("Invalid package.json");
    }
  }

  if (mainFile.endsWith(".js")) {
    const entryPoint = path.join(skillPath, mainFile);
    if (fs.existsSync(entryPoint)) {
      try {
        execSync('node -c "' + entryPoint + '"', { stdio: "ignore", timeout: 5000 });
      } catch (_e: unknown) {
        issues.push("Syntax Error in " + mainFile);
      }
    }
  }

  if (hasPkg && !fs.existsSync(path.join(skillPath, "SKILL.md"))) {
    issues.push("Missing SKILL.md");
  }

  return issues.length > 0 ? { name: skillName, issues } : null;
}

export function autoHeal(skillName: string, issues: string[]): string[] {
  const SKILLS_DIR = getSkillsDir();
  const skillPath = path.join(SKILLS_DIR, skillName);
  const healed: string[] = [];

  for (let i = 0; i < issues.length; i++) {
    if (issues[i] === "Missing node_modules (needs npm install)") {
      try {
        execSync("npm install --production --no-audit --no-fund", {
          cwd: skillPath,
          stdio: "ignore",
          timeout: 30000,
        });
        healed.push(issues[i]);
        console.log("[SkillsMonitor] Auto-healed " + skillName + ": npm install");
      } catch (_e: unknown) {
        // intentionally ignored
      }
    } else if (issues[i] === "Missing SKILL.md") {
      try {
        const name = skillName.replace(/-/g, " ");
        fs.writeFileSync(
          path.join(skillPath, "SKILL.md"),
          "# " + skillName + "\n\n" + name + " skill.\n",
        );
        healed.push(issues[i]);
        console.log("[SkillsMonitor] Auto-healed " + skillName + ": created SKILL.md stub");
      } catch (_e: unknown) {
        // intentionally ignored
      }
    }
  }
  return healed;
}

export function run(options?: RunOptions): SkillIssue[] {
  const heal = options ? options.autoHeal !== false : true;
  const SKILLS_DIR = getSkillsDir();
  const skills = fs.readdirSync(SKILLS_DIR);
  const report: SkillIssue[] = [];

  for (let i = 0; i < skills.length; i++) {
    if (skills[i].startsWith(".")) {
      continue;
    }
    const result = checkSkill(skills[i]);
    if (result) {
      if (heal) {
        const healed = autoHeal(result.name, result.issues);
        result.issues = result.issues.filter((issue: string) => !healed.includes(issue));
        if (result.issues.length === 0) {
          continue;
        }
      }
      report.push(result);
    }
  }
  return report;
}
