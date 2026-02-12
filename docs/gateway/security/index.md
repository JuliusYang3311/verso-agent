---
summary: "Security considerations and threat model for running an AI gateway with shell access"
read_when:
  - Adding features that widen access or automation
title: "Security"
---

# Security 🔒

## Quick check: `verso security audit` (formerly `verso security audit`)

See also: [Formal Verification (Security Models)](/security/formal-verification/)

Run this regularly (especially after changing config or exposing network surfaces):

```bash
verso security audit
verso security audit --deep
verso security audit --fix

# (On older installs, the command is `verso ...`.)
```

It flags common footguns (Gateway auth exposure, browser control exposure, elevated allowlists, filesystem permissions).

`--fix` applies safe guardrails:

- Tighten `groupPolicy="open"` to `groupPolicy="allowlist"` (and per-account variants) for common channels.
- Turn `logging.redactSensitive="off"` back to `"tools"`.
- Tighten local perms (`~/.verso` → `700`, config file → `600`, plus common state files like `credentials/*.json`, `agents/*/agent/auth-profiles.json`, and `agents/*/sessions/sessions.json`).

Running an AI agent with shell access on your machine is... _spicy_. Here’s how to not get pwned.

Verso is both a product and an experiment: you’re wiring frontier-model behavior into real messaging surfaces and real tools. **There is no “perfectly secure” setup.** The goal is to be deliberate about:

Verso is both a product and an experiment: you’re wiring frontier-model behavior into real messaging surfaces and real tools. **There is no “perfectly secure” setup.** The goal is to be deliberate about:

```

## Reporting Security Issues

Found a vulnerability in Verso? Please report responsibly:

1. Email: security@verso.bot
2. Don't post publicly until fixed
3. We'll credit you (unless you prefer anonymity)

---

_"Security is a process, not a product. Also, don't trust lobsters with shell access."_ — Someone wise, probably

🦞🔐
```
