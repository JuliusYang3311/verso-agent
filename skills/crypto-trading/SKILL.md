---
name: crypto-trading
description: Monitor cryptocurrency prices and execute trades. Use when the user asks for crypto prices, market dat, or to buy/sell assets.
---

# Crypto Trading Skill

This skill allows you to check cryptocurrency prices and execute trades via on-chain DeFi protocols.

## Configuration

To use wallet features, configure via `verso config` or set manually:

### On-Chain Configuration (Multi-chain)
To use on-chain wallet features (native transfers & swaps):
- `WALLET_PRIVATE_KEY`: Your wallet private key (keep this secure!).
- `RPC_URL`: RPC Endpoint. **The script automatically detects the network (Polygon, Ethereum, Optimism, Arbitrum) based on this URL.**
  - **Polygon**: `https://polygon-rpc.com`
  - **Ethereum**: `https://cloudflare-eth.com`
  - **Optimism**: `https://mainnet.optimism.io`
  - **Arbitrum**: `https://arb1.arbitrum.io/rpc`
- `EXPLORER_API_KEY`: **Etherscan API Key** (Unified V2). One key now works for all networks (Polygon, Optimism, Arbitrum, Ethereum).

### Troubleshooting
If you encounter "Too many requests", try using a different RPC URL. The script automatically optimizes Gas fees (EIP-1559) for efficiency.

## Capabilities

### 1. Check Prices & History

Use `get_price.py` for market data or `evm_wallet.py` for history.

**Usage:**
```bash
# Market Price
python3 skills/crypto-trading/scripts/get_price.py bitcoin

# Wallet History (Last 10 Txs)
python3 skills/crypto-trading/scripts/evm_wallet.py --action history
```

### 2. On-Chain Wallet (EVM)

Use the `scripts/evm_wallet.py` script to interact with your wallet.

**Usage:**
```bash
# Check Balance
python3 skills/crypto-trading/scripts/evm_wallet.py --action balance

# Check Portfolio (Scan all known tokens)
python3 skills/crypto-trading/scripts/evm_wallet.py --action portfolio

# Get Explorer URL
python3 skills/crypto-trading/scripts/evm_wallet.py --action explorer

# Check ERC-20 Token Balance
python3 skills/crypto-trading/scripts/evm_wallet.py --action balance --token 0xA0b8...
```

### 3. DeFi Trading (Uniswap V3)

Perform on-chain swaps directly via your wallet.

**Commands:**

*   **Quote Price (Check rate):**
    ```bash
    python3 skills/crypto-trading/scripts/evm_wallet.py --action quote --token-in <Addr> --token-out <Addr> --amount 1
    ```

*   **Approve Token (One-time setup per token):**
    ```bash
    python3 skills/crypto-trading/scripts/evm_wallet.py --action approve --token <Addr> --amount 100
    ```

*   **Swap with Slippage Protection:**
    ```bash
    # Default slippage is 0.5%
    python3 skills/crypto-trading/scripts/evm_wallet.py --action swap --token-in <Addr> --token-out <Addr> --amount 10 --slippage 1.0
    ```

**Note:**
- `evm_wallet.py` requires `web3` library.

## Dependencies

- Python 3
- `pip install web3`
- `pip install requests`
