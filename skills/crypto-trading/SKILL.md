---
name: crypto-trading
description: Monitor cryptocurrency prices and execute trades on Solana (Primary) and EVM chains.
---

# Crypto Trading Skill

This skill allows you to check cryptocurrency prices and execute trades via on-chain DeFi protocols.
**Primary Chain: Solana** (replacing previous default).

## Configuration

To use wallet features, run `verso configure`.

### Solana Configuration (Required)

- `SOLANA_PRIVATE_KEY`: Your Base58 Wallet Private Key.

### Advanced Configuration / RPC

- `ALCHEMY_API_KEY`: Accelerate Solana transactions with private RPC.
- `SOLANA_RPC_URL`: Custom RPC URL (Optional).
- `SOLANA_TRACKER_API_KEY`: Optional API key for Solana Tracker (better rate limits).

## Capabilities

### 1. Solana Wallet (Primary)

Interact with the Solana blockchain using `skills/crypto-trading/scripts/sol_wallet.py`.

**Key Features:**

- **Auto-Config**: Loads key/RPC from `~/.verso/verso.json`.
- **Robust Keys**: Supports both **Base58** and **Hex** keys.
- **Price Source**: **CoinGecko** (Primary) with DexScreener (Fallback).
- **Dynamic Discovery**: Automatically identifies unknown tokens.
- **Portfolio Tracking**: View SOL and token holdings with real-time pricing.

**Swap (Solana Tracker API):**

> **Note**: Uses Solana Tracker V2 API (`swap-v2.solanatracker.io`). Supports optional API key for high volume.

```bash
# Quote only
python3 skills/crypto-trading/scripts/sol_wallet.py --action quote --token-in SOL --token-out USDC --amount 0.1

# Execute Swap with Priority Fee (for congestion)
python3 skills/crypto-trading/scripts/sol_wallet.py --action swap \
  --token-in SOL --token-out USDC \
  --amount 0.1 \
  --slippage 0.5 \
  --priority-fee auto
```

**Transfer:**

```bash
python3 skills/crypto-trading/scripts/sol_wallet.py --action transfer --to <RecipientAddr> --amount 0.5
```

**Portfolio / Balance:**

```bash
# Check SOL and token holdings
python3 skills/crypto-trading/scripts/sol_wallet.py --action balance

# Monitor portfolio continuously (every 10s)
python3 skills/crypto-trading/scripts/sol_wallet.py --action monitor
```

### 2. Drift Protocol (v2)

Interact with Drift Protocol on Solana using the `skills/crypto-trading/scripts/` suite.

**Features:**

- **Audit**: Comprehensive account health, spot/perp positions, and PnL.
- **Trade**: Market/Limit orders, multiple markets, dynamic asset support.
- **Transfer**: Deposit/Withdraw assets (USDC, SOL, etc.).
- **Leverage**: Monitor account leverage capabilities.

#### Audit Account

```bash
python3.11 skills/crypto-trading/scripts/drift_audit.py
```

_Outputs JSON report to `~/Documents/verso/Crypto` and summary to console._

#### Transfer Funds (Deposit/Withdraw)

```bash
# Deposit 10 USDC
python3.11 skills/crypto-trading/scripts/drift_transfer.py deposit --amount 10 --asset USDC

# Withdraw 0.5 SOL
python3.11 skills/crypto-trading/scripts/drift_transfer.py withdraw --amount 0.5 --asset SOL
```

#### Trading (Perp Markets)

```bash
# Market Buy (Long) 1 SOL-PERP
python3.11 skills/crypto-trading/scripts/drift_trader.py trade --market SOL-PERP --side long --amount 1 --type market

# Limit Sell (Short) 0.5 BTC-PERP @ $65,000
python3.11 skills/crypto-trading/scripts/drift_trader.py trade --market BTC-PERP --side short --amount 0.5 --type limit --price 65000

# List Open Orders
python3.11 skills/crypto-trading/scripts/drift_trader.py orders

# Cancel Orders (All or specific market)
python3.11 skills/crypto-trading/scripts/drift_trader.py cancel --market SOL-PERP
```

#### Leverage & Account

```bash
# Check current leverage and margin usage
python3.11 skills/crypto-trading/scripts/drift_leverage.py check
```

### 3. Generic Price Check

Check the price of any cryptocurrency via CoinGecko using `skills/crypto-trading/scripts/get_price.py`.

**Usage:**

```bash
# Get price in USD (Default)
python3 skills/crypto-trading/scripts/get_price.py solana

# Get price in a specific currency (e.g., EUR)
python3 skills/crypto-trading/scripts/get_price.py bitcoin eur
```

> [!TIP]
> This tool uses **CoinGecko IDs** (e.g., `solana`, `ethereum`, `tether`) for queries.

## Dependencies

- Python 3
- `pip install solana solders requests`
