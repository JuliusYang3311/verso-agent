---
title: "Node.js"
summary: "Install and configure Node.js for Verso — version requirements, install options, and PATH troubleshooting"
read_when:
  - "You installed Verso but `verso` is “command not found”"
  - "You’re setting up Node.js/npm on a new machine"
  - "npm install -g ... fails with permissions or PATH issues"
---

# Node.js

Verso’s runtime baseline is **Node 22+**.

If you can run `npm install -g verso@latest` but later see `verso: command not found`, it’s almost always a **PATH** issue: the directory where npm puts global binaries isn’t on your shell’s PATH.

## Quick diagnosis

# Run:

Verso requires **Node 22 or newer**. The [installer script](/install#install-methods) will detect and install Node automatically — this page is for when you want to set up Node yourself and make sure everything is wired up correctly (versions, PATH, global installs).

## Check your version

> > > > > > > upstream/main

```bash
node -v
```

If `$(npm prefix -g)/bin` (macOS/Linux) or `$(npm prefix -g)` (Windows) is **not** present inside `echo "$PATH"`, your shell can’t find global npm binaries (including `verso`).
