# MEMORY.md - Long-Term Memory (Julius)

## Identity & Preferences

- User: **Julius**. Preferred address: **“Julius”**.
- Assistant name: **verso**.
- Preference: “Be yourself” — act with your own opinions/style; don’t mimic a prior assistant persona.
- Efficiency-first communication: be direct; avoid filler.

## Workspace & Runtime (Verso)

- Workspace root: `/Users/veso/verso`.
- Skills root: `/Users/veso/Documents/verso/skills`.
- Utility sub-agent shared memory/config: `/Users/veso/verso/utility`.
- Videogeneration: **use outputPath from `verso.json`** → `/Users/veso/Documents/verso/video_generation` (don’t invent a different output dir).

## Capability Evolver (capability-evolver)

- Goal: run evolver with an explicit workspace so it can find `MEMORY.md`, `USER.md`, and `skills`.
- Key env var: `OPENCLAW_WORKSPACE` controls `WORKSPACE_ROOT` (fallback otherwise can point to the wrong place).
- Symptoms when misconfigured: `NO_SKILLS_DIR`, `[MEMORY.md MISSING]`, `[USER.md MISSING]`.
- Note: system lacks `rg`; use `grep -R` instead.

## Process / Protocol (VIAP)

- Do **not** maintain a separate VIAP protocol markdown file; keep the protocol/process **in memory** (this file) and write it in **English**.
- **Workflow preference (Julius):** video制作与发布（尤其是Twitter）需要交给子Verso/子agent去做；主Verso负责统筹与审核，发布前先给Julius确认。

### VIAP v3 — Main Verso ↔ utility agent execution protocol

**Goal:** Main Verso sends a task as JSON to the `utility` sub-agent; the sub-agent executes; then returns **one JSON report**. Main Verso converts that into a human-readable summary for Julius.

#### Transport

- **Task dispatch:** Main Verso uses `sessions_spawn(agentId="utility")` and includes exactly one `VIAP_V3_TASK` JSON in the message.
- **Result return:** utility agent’s final answer must contain **only one** `VIAP_V3_REPORT` JSON (ideally as the last code block).

#### JSON contract

**Task (Main → utility):**

- Minimum required fields:
  - `viap_version`, `type`, `task_id`, `title`, `goal`, `instructions[]`
- Recommended structure:
  - `context.workspace_root`, `context.cwd`
  - `inputs.env` (e.g. `OPENCLAW_WORKSPACE`, `MEMORY_DIR`), `inputs.args`, `inputs.files`
  - `constraints.do_not[]`, `constraints.risk` (low|med|high), `constraints.time_budget_min`
  - `output.expected_artifacts[]`, `output.report_format="VIAP_V3_REPORT_JSON_ONLY"`

**Report (utility → Main):**

- Minimum required fields:
  - `viap_version`, `type`, `task_id`, `success`, `summary`
- Recommended fields:
  - `steps[]`: each step includes `what`, and optionally `command`, `cwd`, `result`
  - `artifacts[]`: `{path, description, sha256?}`
  - `metrics`: `{start_time, end_time, duration_sec}`
  - `errors[]`: reproducible error info (where/message/stderr_tail)
  - `logs`: `{stdout_tail, stderr_tail}`
  - `next_actions[]`

#### JSON examples

**Task (Main → utility)**

```json
{
  "viap_version": "3",
  "type": "VIAP_V3_TASK",
  "task_id": "2026-02-10T19:34:00-0800_evolver_workspace_001",
  "title": "One-line title",
  "goal": "Success criteria / acceptance definition",
  "instructions": ["Step 1: do X", "Step 2: do Y"],
  "context": {
    "workspace_root": "/Users/veso/verso",
    "cwd": "/Users/veso/Documents/evolver-1.10.0",
    "notes": "Any important background"
  },
  "inputs": {
    "env": {
      "OPENCLAW_WORKSPACE": "/Users/veso/verso",
      "MEMORY_DIR": "/Users/veso/verso/memory"
    },
    "args": ["--review"],
    "files": []
  },
  "constraints": {
    "do_not": ["Do not send email / do not publish externally"],
    "risk": "low|med|high",
    "time_budget_min": 20
  },
  "output": {
    "expected_artifacts": ["Paths or filenames (if any outputs are produced)"],
    "report_format": "VIAP_V3_REPORT_JSON_ONLY"
  }
}
```

Required fields (minimum set):

- `viap_version`, `type`, `task_id`, `title`, `goal`, `instructions[]`

**Report (utility → Main)**

```json
{
  "viap_version": "3",
  "type": "VIAP_V3_REPORT",
  "task_id": "2026-02-10T19:34:00-0800_evolver_workspace_001",
  "success": true,
  "summary": "One-line conclusion",
  "steps": [
    {
      "what": "What was done",
      "command": "The command that was run (if any)",
      "cwd": "Working directory for the command (if any)",
      "result": "Result / observation"
    }
  ],
  "artifacts": [
    {
      "path": "/Users/veso/verso/somefile.txt",
      "description": "Artifact description",
      "sha256": null
    }
  ],
  "metrics": {
    "start_time": "2026-02-10T19:35:00-0800",
    "end_time": "2026-02-10T19:40:00-0800",
    "duration_sec": 300
  },
  "errors": [
    {
      "where": "step name or command",
      "message": "Error message",
      "stderr_tail": "Last lines of stderr (optional)"
    }
  ],
  "logs": {
    "stdout_tail": "Last N lines of stdout (optional)",
    "stderr_tail": "Last N lines of stderr (optional)"
  },
  "next_actions": ["Suggested next steps / blockers"]
}
```

Required fields (minimum set):

- `viap_version`, `type`, `task_id`, `success`, `summary`

#### Behavior constraints (utility agent)

- Default scope: **local workspace-only** operations.
- External actions (email / posting / crypto trading / anything that leaves the machine):
  - **Only do them when Julius explicitly instructs.**
  - If not explicitly instructed, do **not** attempt them; return `success=false` with an `errors[]` entry explaining “requires explicit Julius instruction”.
  - Julius preference: no “blocked” status spam; surface **success or error only**.
- Command executions must be logged in `steps[].command` and `steps[].cwd`.

#### Main Verso handling of a report

- Validate `task_id` matches the dispatched task.
- Summarize for Julius: conclusion, what was done, artifacts/paths, and next actions.
- If `success=false`, prioritize actionable fix steps.
