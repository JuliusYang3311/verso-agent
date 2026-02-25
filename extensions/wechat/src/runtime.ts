import type { PluginRuntime } from "verso/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setWeChatRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getWeChatRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("WeChat runtime not initialized");
  }
  return runtime;
}
