export type CryptoConfig = {
  enabled?: boolean;
  alchemyApiKey?: string;
  solanaRpcUrl?: string; // e.g. https://api.mainnet-beta.solana.com
  solanaPrivateKey?: string; // Base58
  jupiterApiKey?: string; // x-api-key for Jupiter v6+
};
