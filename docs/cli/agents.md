---
summary: "CLI reference for `verso agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
---

# `verso agents`

Manage isolated agents (workspaces + auth + routing).

Related:
- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
verso agents list
verso agents add work --workspace ~/verso-work
verso agents set-identity --workspace ~/verso --from-identity
verso agents set-identity --agent main --avatar avatars/verso.png
verso agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:
- Example path: `~/verso/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:
- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
verso agents set-identity --workspace ~/verso --from-identity
```

Override fields explicitly:

```bash
verso agents set-identity --agent main --name "Verso" --emoji "🦞" --avatar avatars/verso.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "Verso",
          theme: "space lobster",
          emoji: "🦞",
          avatar: "avatars/verso.png"
        }
      }
    ]
  }
}
```
