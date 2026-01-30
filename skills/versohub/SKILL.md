---
name: versohub
description: Use the VersoHub CLI to search, install, update, and publish agent skills from versohub.com. Use when you need to fetch new skills on the fly, sync installed skills to latest or a specific version, or publish new/updated skill folders with the npm-installed versohub CLI.
metadata: {"verso":{"requires":{"bins":["versohub"]},"install":[{"id":"node","kind":"node","package":"versohub","bins":["versohub"],"label":"Install VersoHub CLI (npm)"}]}}
---

# VersoHub CLI

Install
```bash
npm i -g versohub
```

Auth (publish)
```bash
versohub login
versohub whoami
```

Search
```bash
versohub search "postgres backups"
```

Install
```bash
versohub install my-skill
versohub install my-skill --version 1.2.3
```

Update (hash-based match + upgrade)
```bash
versohub update my-skill
versohub update my-skill --version 1.2.3
versohub update --all
versohub update my-skill --force
versohub update --all --no-input --force
```

List
```bash
versohub list
```

Publish
```bash
versohub publish ./my-skill --slug my-skill --name "My Skill" --version 1.2.0 --changelog "Fixes + docs"
```

Notes
- Default registry: https://versohub.com (override with VERSOHUB_REGISTRY or --registry)
- Default workdir: cwd (falls back to Verso workspace); install dir: ./skills (override with --workdir / --dir / VERSOHUB_WORKDIR)
- Update command hashes local files, resolves matching version, and upgrades to latest unless --version is set
