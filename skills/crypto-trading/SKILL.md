---
name: crypto-trading
description: Monitor cryptocurrency prices and execute trades. Use when the user asks for crypto prices, market dat, or to buy/sell assets.
---

# Crypto Trading Skill

This skill allows you to check cryptocurrency prices and execute trades via on-chain DeFi protocols.

## Configuration

To use wallet features, configure via `verso config` or set manually:

### On-Chain Configuration (Private RPC)
To use on-chain wallet features, you **must** configure an Alchemy API Key for stability.

- `WALLET_PRIVATE_KEY`: Your wallet private key.
- `ALCHEMY_API_KEY`: Your Alchemy Project API Key.
- `EXPLORER_API_KEY`: Etherscan Unified API Key (Optional).

*Run `verso configure` to set these up interactively.*

## Capabilities

### 1. Check Prices & History

**Usage:**
```bash
# Wallet History (Polygon default)
python3 skills/crypto-trading/scripts/evm_wallet.py --action history

# Check Ethereum History
python3 skills/crypto-trading/scripts/evm_wallet.py --action history --network ethereum
```

### 2. On-Chain Wallet (EVM)
Supports **Polygon**, **Ethereum**, **Optimism**, **Arbitrum**.
Use `--network <name>` to switch chains (default: `polygon`).

**Balance:**
```bash
python3 skills/crypto-trading/scripts/evm_wallet.py --action balance --network optimism
```

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
    # Default slippage is 0.5%
    python3 skills/crypto-trading/scripts/evm_wallet.py --action swap --token-in <Addr> --token-out <Addr> --amount 10 --slippage 1.0
    ```

*   **Custom Fee Tier (For Low Liquidity / Stablecoins):**
    ```bash
    # Use 500 for Stablecoins (0.05%), 3000 for standard (0.3%), 10000 for exotic (1%)
    python3 skills/crypto-trading/scripts/evm_wallet.py --action quote --token-in <Addr> --token-out <Addr> --amount 1 --fee 500
    ```

**Note:**
- `evm_wallet.py` requires `web3` library.

## Dependencies

- Python 3
- `pip install web3`
- `pip install requests`
