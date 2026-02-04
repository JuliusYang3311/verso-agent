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

  const alchemyApiKey = (await guardCancel(
    text({
      message: "Alchemy API Key (Required for Private RPC)",
      placeholder: "Your Alchemy Key",
      initialValue: existing?.alchemyApiKey || "",
    }),
    runtime,
  )) as string;

  const defaultSolanaRpc = alchemyApiKey
    ? `https://solana-mainnet.g.alchemy.com/v2/${alchemyApiKey}`
    : "https://api.mainnet-beta.solana.com";

  const solanaRpcUrl = (await guardCancel(
    text({
      message: "Solana RPC URL",
      placeholder: "https://api.mainnet-beta.solana.com",
      initialValue: existing?.solanaRpcUrl || defaultSolanaRpc,
    }),
    runtime,
  )) as string;

  const jupiterApiKey = (await guardCancel(
    text({
      message: "Jupiter API Key (Required for Price/Swap)",
      placeholder: "Your x-api-key from jup.ag",
      initialValue: existing?.jupiterApiKey || "",
    }),
    runtime,
  )) as string;

  const solanaPrivateKey = (await guardCancel(
    text({
      message: "Solana Private Key (Base58 string)",
      placeholder: "Your Base58 Private Key",
      initialValue: existing?.solanaPrivateKey,
    }),
    runtime,
  )) as string;

  return {
    ...nextConfig,
    crypto: {
      enabled,
      alchemyApiKey: alchemyApiKey || undefined,
      solanaRpcUrl,
      solanaPrivateKey: solanaPrivateKey || undefined,
      jupiterApiKey: jupiterApiKey || undefined,
    },
  };
}
