import type { PluginRuntime } from "verso/plugin-sdk";

let _runtime: PluginRuntime | null = null;

export function setWecomRuntime(runtime: PluginRuntime): void {
  _runtime = runtime;
}

export function getWecomRuntime(): PluginRuntime {
  if (!_runtime) throw new Error("[wecom] Runtime not initialized");
  return _runtime;
}
