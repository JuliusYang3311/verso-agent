export type CryptoConfig = {
  enabled?: boolean;
  alchemyApiKey?: string;
  solanaRpcUrl?: string; // e.g. https://api.mainnet-beta.solana.com
  proxy?: string; // HTTP Proxy for API calls
  solanaPrivateKey?: string; // Base58
};
