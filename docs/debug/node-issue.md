---
summary: Node + tsx "__name is not a function" crash notes and workarounds
read_when:
  - Debugging Node-only dev scripts or watch mode failures
  - Investigating tsx/esbuild loader crashes in Verso
---

# Node + tsx "\_\_name is not a function" crash

## Summary

Running Verso via Node with `tsx` fails at startup with:

```
[verso] Failed to start CLI: TypeError: __name is not a function
```
