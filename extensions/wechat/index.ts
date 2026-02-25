import type { VersoPluginApi } from "verso/plugin-sdk";
import { emptyPluginConfigSchema } from "verso/plugin-sdk";
import { wechatPlugin } from "./src/channel.js";
import { setWeChatRuntime } from "./src/runtime.js";

export { wechatPlugin } from "./src/channel.js";
export type { WeChatConfig, WeChatAccountConfig, ResolvedWeChatAccount } from "./src/types.js";

const plugin = {
  id: "wechat",
  name: "WeChat",
  description: "WeChat channel via Proxy API",
  configSchema: emptyPluginConfigSchema(),
  register(api: VersoPluginApi) {
    setWeChatRuntime(api.runtime);
    api.registerChannel({ plugin: wechatPlugin });
  },
};

export default plugin;
