---
summary: "CLI reference for `verso reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
---

# `verso reset`

Reset local config/state (keeps the CLI installed).

```bash
verso reset
verso reset --dry-run
verso reset --scope config+creds+sessions --yes --non-interactive
```

