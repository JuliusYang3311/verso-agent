---
summary: "Plugin manifest + JSON schema requirements (strict config validation)"
read_when:
  - You are building a Verso plugin
  - You need to ship a plugin config schema or debug plugin validation errors
title: "Plugin Manifest"
---

# Plugin manifest (verso.plugin.json)

Every plugin **must** ship a `verso.plugin.json` file in the **plugin root**.
Verso uses this manifest to validate configuration \*\*without executing plugin
