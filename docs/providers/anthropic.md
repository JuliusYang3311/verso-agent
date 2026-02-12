---
summary: "Use Anthropic Claude via API keys or setup-token in Verso"
read_when:
  - You want to use Anthropic models in Verso
  - You want setup-token instead of API keys
title: "Anthropic"
---

# Anthropic (Claude)

Anthropic builds the **Claude** model family and provides access via an API.
In Verso you can authenticate with an API key or a **setup-token**.

## Option A: Anthropic API key

**Best for:** standard API access and usage-based billing.
Create your API key in the Anthropic Console.

### CLI setup

```bash
verso onboard
# choose: Anthropic API key

# or non-interactive
verso onboard --anthropic-api-key "$ANTHROPIC_API_KEY"
```

### Config snippet

```json5
{
  env: { ANTHROPIC_API_KEY: "sk-ant-..." },
  agents: { defaults: { model: { primary: "anthropic/claude-opus-4-6" } } },
}
```

## Prompt caching (Anthropic API)

Verso does **not** override Anthropic’s default cache TTL unless you set it.
This is **API-only**; subscription auth does not honor TTL settings.
