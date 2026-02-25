import type { VersoPluginApi } from "verso/plugin-sdk";
import { emptyPluginConfigSchema } from "verso/plugin-sdk";
import { wecomPlugin } from "./src/channel.js";
import { wecomHttpHandler } from "./src/http-handler.js";
import { setWecomRuntime } from "./src/runtime.js";

const plugin = {
  id: "wecom",
  name: "Enterprise WeChat",
  description: "Enterprise WeChat (WeCom) AI Bot channel plugin for Verso",
  configSchema: emptyPluginConfigSchema(),
  register(api: VersoPluginApi) {
    setWecomRuntime(api.runtime);
    api.registerChannel({ plugin: wecomPlugin });
    api.registerHttpHandler(wecomHttpHandler);
  },
};

export default plugin;
