import type { VersoConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { confirm, text } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";

export async function promptCryptoConfig(
  nextConfig: VersoConfig,
  runtime: RuntimeEnv,
): Promise<VersoConfig> {
  const existing = nextConfig.crypto;

  const enabled = (await guardCancel(
    confirm({
      message: "Enable Crypto Trading & Wallet features?",
      initialValue: existing?.enabled ?? false,
    }),
    runtime,
  )) as boolean;

  if (!enabled) {
    return {
      ...nextConfig,
      crypto: { ...existing, enabled: false },
    };
  }

  const rpcUrl = (await guardCancel(
    text({
      message: "RPC URL (for EVM Wallet)",
      placeholder: "https://polygon-rpc.com",
      initialValue: existing?.rpcUrl || "https://polygon-rpc.com",
    }),
    runtime,
  )) as string;

  const privateKey = (await guardCancel(
    text({
      message: "Wallet Private Key (Address will be derived)",
      placeholder: "0x...",
      initialValue: existing?.privateKey,
    }),
    runtime,
  )) as string;

  const explorerApiKey = (await guardCancel(
    text({
      message: "Polygonscan/Etherscan API Key (Optional, for fast portfolio)",
      placeholder: "Your API Key",
      initialValue: existing?.explorerApiKey,
    }),
    runtime,
  )) as string;

  return {
    ...nextConfig,
    crypto: {
      enabled,
      rpcUrl: rpcUrl || undefined,
      privateKey: privateKey || undefined,
      explorerApiKey: explorerApiKey || undefined,
    },
  };
}
