---
summary: "CLI reference for `verso plugins` (list, install, enable/disable, doctor)"
read_when:
  - You want to install or manage in-process Gateway plugins
  - You want to debug plugin load failures
title: "plugins"
---

# `verso plugins`

Manage Gateway plugins/extensions (loaded in-process).

Related:

- Plugin system: [Plugins](/tools/plugin)
- Plugin manifest + schema: [Plugin manifest](/plugins/manifest)
- Security hardening: [Security](/gateway/security)

## Commands

```bash
verso plugins list
verso plugins info <id>
verso plugins enable <id>
verso plugins disable <id>
verso plugins doctor
verso plugins update <id>
verso plugins update --all
```

Bundled plugins ship with Verso but start disabled. Use `plugins enable` to
activate them.

All plugins must ship a `verso.plugin.json` file with an inline JSON Schema
(`configSchema`, even if empty). Missing/invalid manifests or schemas prevent
the plugin from loading and fail config validation.

### Install

```bash
verso plugins install <path-or-spec>
```

Security note: treat plugin installs like running code. Prefer pinned versions.

Supported archives: `.zip`, `.tgz`, `.tar.gz`, `.tar`.

Use `--link` to avoid copying a local directory (adds to `plugins.load.paths`):

```bash
verso plugins install -l ./my-plugin
```

### Update

```bash
verso plugins update <id>
verso plugins update --all
verso plugins update <id> --dry-run
```

Updates only apply to plugins installed from npm (tracked in `plugins.installs`).
