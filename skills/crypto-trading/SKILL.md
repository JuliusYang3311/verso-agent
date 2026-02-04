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

## Capabilities

### 1. Solana Wallet (Primary)
Interact with the Solana blockchain using `skills/crypto-trading/scripts/sol_wallet.py`.

**Key Features:**
- **Auto-Config**: Loads key/RPC from `~/.verso/verso.json`.
- **Robust Keys**: Supports both **Base58** (Standard) and **Hex** (0x...) private keys.

**Portfolio, Monitor & Balance:**
```bash
# View complete portfolio (SOL + SPL Tokens + USD Value)
python3 skills/crypto-trading/scripts/sol_wallet.py --action portfolio

# Track SOL Price real-time
python3 skills/crypto-trading/scripts/sol_wallet.py --action monitor --interval 10

# Check specific token balance
python3 skills/crypto-trading/scripts/sol_wallet.py --action balance --token USDC
```

**Swap (Jupiter Aggregator):**
```bash
# Quote only
python3 skills/crypto-trading/scripts/sol_wallet.py --action quote --token-in SOL --token-out USDC --amount 0.1

# Execute Swap with Priority Fee (for congestion)
python3 skills/crypto-trading/scripts/sol_wallet.py --action swap \
  --token-in SOL --token-out USDC \
  --amount 0.1 \
  --slippage 0.5 \
  --priority-fee 10000 
  # or --priority-fee auto
```

**Transfer:**
```bash
python3 skills/crypto-trading/scripts/sol_wallet.py --action transfer --to <RecipientAddr> --amount 0.5
```

## Dependencies

- Python 3
- `pip install solana solders requests`

