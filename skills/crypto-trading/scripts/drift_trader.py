#!/usr/bin/env python3.11
import os
import sys
import json
import asyncio
import argparse
from typing import Optional, Dict, Any, List, Union
from solders.keypair import Keypair # type: ignore
from solders.pubkey import Pubkey # type: ignore
from driftpy.drift_client import DriftClient
from driftpy.constants.numeric_constants import (
    QUOTE_PRECISION, 
    BASE_PRECISION, 
    PRICE_PRECISION
)
from driftpy.types import (
    PositionDirection, 
    OrderType, 
    MarketType, 
    OrderParams,
    PostOnlyParams
)
from driftpy.constants.perp_markets import mainnet_perp_market_configs
from anchorpy import Wallet
from solana.rpc.async_api import AsyncClient

# Default path for records
DEFAULT_RECORDS_PATH = "/Users/veso/Documents/verso/Crypto"

PERP_MARKET_MAP = {m.symbol: m for m in mainnet_perp_market_configs}

def get_keypair(pk_str: str) -> Keypair:
    if pk_str.startswith("[") or "," in pk_str:
        import ast
        raw_bytes = bytes(ast.literal_eval(pk_str))
        return Keypair.from_bytes(raw_bytes)
    elif len(pk_str) >= 64 and all(c in "0123456789abcdefABCDEF" for c in pk_str.replace("0x", "")):
        hex_str = pk_str[2:] if pk_str.startswith("0x") else pk_str
        return Keypair.from_seed(bytes.fromhex(hex_str[:64]))
    else:
        return Keypair.from_base58_string(pk_str)

def log_transaction(action: str, data: Dict[str, Any], output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    timestamp = int(os.popen('date +%s').read().strip())
    log_entry = {
        "timestamp": timestamp,
        "timestamp_iso": os.popen('date -u +"%Y-%m-%dT%H:%M:%SZ"').read().strip(),
        "action": action,
        "data": data
    }
    filename = f"drift_tx_{action}_{timestamp}.json"
    filepath = os.path.join(output_dir, filename)
    with open(filepath, 'w') as f:
        json.dump(log_entry, f, indent=2)
    print(f"Transaction logged to: {filepath}")

async def run_trader():
    parser = argparse.ArgumentParser(description="Drift Protocol Trader")
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # Trade Command
    trade_parser = subparsers.add_parser("trade", help="Execute a trade")
    trade_parser.add_argument("--side", choices=["long", "short"], required=True)
    trade_parser.add_argument("--amount", type=float, required=True)
    trade_parser.add_argument("--market", default="SOL-PERP")
    trade_parser.add_argument("--type", choices=["market", "limit"], default="market")
    trade_parser.add_argument("--price", type=float)
    trade_parser.add_argument("--sub-account", type=int, default=0)

    # Balance Command
    subparsers.add_parser("balance", help="Show sub-account balance and health")

    parser.add_argument("--rpc", help="Solana RPC URL")
    parser.add_argument("--key", help="Private Key")
    parser.add_argument("--output-dir", default=DEFAULT_RECORDS_PATH, help="Directory to save logs")
    
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    # Load credentials
    rpc_url = args.rpc or os.environ.get("SOLANA_RPC_URL")
    pk_str = args.key or os.environ.get("SOLANA_PRIVATE_KEY")
    
    config_path = os.path.expanduser("~/.verso/verso.json")
    if (not rpc_url or not pk_str) and os.path.exists(config_path):
        try:
            with open(config_path, 'r') as f:
                conf = json.load(f)
                crypto_conf = conf.get('crypto', {})
                if not rpc_url: rpc_url = crypto_conf.get("solanaRpcUrl") or conf.get("SOLANA_RPC_URL")
                if not pk_str: pk_str = crypto_conf.get("solanaPrivateKey") or conf.get("SOLANA_PRIVATE_KEY")
        except: pass
            
    if not rpc_url: rpc_url = "https://api.mainnet-beta.solana.com"
    if not pk_str:
        print("Error: Private Key is required.")
        sys.exit(1)

    kp = get_keypair(pk_str)
    wallet = Wallet(kp)
    connection = AsyncClient(rpc_url)
    
    drift_client = DriftClient(connection, wallet, "mainnet")
    await drift_client.subscribe()
    
    try:
        if args.command == "trade":
            market_symbol = args.market.upper()
            if not market_symbol.endswith("-PERP"): market_symbol += "-PERP"
                
            market_conf = PERP_MARKET_MAP.get(market_symbol)
            if not market_conf:
                print(f"Error: Unknown market '{args.market}'.")
                return

            market_index = market_conf.market_index
            direction = PositionDirection.Long() if args.side == "long" else PositionDirection.Short()
            base_amount_raw = int(args.amount * BASE_PRECISION)
            
            order_type = OrderType.Market()
            price_raw = 0
            
            if args.type == "limit":
                if args.price is None:
                    print("Error: --price is required for limit orders")
                    return
                order_type = OrderType.Limit()
                price_raw = int(args.price * PRICE_PRECISION)

            order_params = OrderParams(
                order_type=order_type,
                market_type=MarketType.Perp(),
                direction=direction,
                base_asset_amount=base_amount_raw,
                price=price_raw,
                market_index=market_index,
            )
            
            print(f"Placing {args.side} {args.type} order for {args.amount} {market_symbol}...")
            sig = await drift_client.place_perp_order(order_params, sub_account_id=args.sub_account)
            print(f"Order placed successfully. Signature: {sig}")
            
            log_transaction("trade", {
                "market": market_symbol, "side": args.side, "type": args.type,
                "amount": args.amount, "price": args.price, "signature": str(sig)
            }, args.output_dir)

        elif args.command == "balance":
            user = drift_client.get_user(sub_account_id=0) # Simple default for testing
            await user.subscribe()
            health = user.get_health()
            collateral = user.get_total_collateral() / QUOTE_PRECISION
            print(f"Sub-account 0 Health: {health}")
            print(f"Total Collateral: ${collateral:.2f}")
            await user.unsubscribe()

    except Exception as e:
        print(f"Error executing {args.command}: {e}")
    finally:
        await drift_client.unsubscribe()
        await connection.close()

if __name__ == "__main__":
    asyncio.run(run_trader())
