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
from driftpy.drift_user import DriftUser
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

# Build dynamic map for Perp Markets (Symbol -> Index)
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
    trade_parser = subparsers.add_parser("trade", help="Execute a trade (Open/Close Position)")
    trade_parser.add_argument("--side", choices=["long", "short"], required=True, help="Trade side")
    trade_parser.add_argument("--amount", type=float, required=True, help="Amount in Base Asset (e.g. 1.5 SOL)")
    trade_parser.add_argument("--market", default="SOL-PERP", help="Perp Market Symbol (e.g. SOL-PERP, BTC-PERP). Default: SOL-PERP")
    trade_parser.add_argument("--type", choices=["market", "limit"], default="market", help="Order Type")
    trade_parser.add_argument("--price", type=float, help="Limit Price (Required for limit orders)")
    trade_parser.add_argument("--leverage", type=float, help="Optional: Calculate amount based on target leverage (Overwrites --amount if set)")
    trade_parser.add_argument("--sub-account", type=int, default=0, help="Drift sub-account ID")
    
    # Cancel Command
    cancel_parser = subparsers.add_parser("cancel", help="Cancel open orders")
    cancel_parser.add_argument("--market", help="Filter by Market Symbol")
    cancel_parser.add_argument("--sub-account", type=int, default=0, help="Drift sub-account ID")

    # Orders Command
    orders_parser = subparsers.add_parser("orders", help="List open orders")
    orders_parser.add_argument("--sub-account", type=int, default=0, help="Drift sub-account ID")

    # Common Arguments
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
        except:
            pass
            
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
            # Resolve Market
            market_symbol = args.market.upper()
            if not market_symbol.endswith("-PERP"):
                market_symbol += "-PERP"
                
            market_conf = PERP_MARKET_MAP.get(market_symbol)
            if not market_conf:
                 # Try finding by index if user passed int
                try:
                    idx = int(args.market)
                    market_conf = next((m for m in mainnet_perp_market_configs if m.market_index == idx), None)
                except:
                    pass
            
            if not market_conf:
                print(f"Error: Unknown market '{args.market}'.")
                return

            market_index = market_conf.market_index
            
            # TODO: Leverage calculation logic could be added here to dynamically calc amount
            # user_client = DriftUser(drift_client, sub_account_id=args.sub_account)
            # await user_client.subscribe()
            # if args.leverage: ...
            
            amount = args.amount
            price = args.price

            print(f"Placing {args.side} {args.type} order for {amount} {market_symbol}...")
            
            direction = PositionDirection.Long() if args.side == "long" else PositionDirection.Short()
            base_amount_raw = int(amount * BASE_PRECISION)
            
            order_type = OrderType.Market()
            price_raw = 0
            
            if args.type == "limit":
                if price is None:
                    print("Error: --price is required for limit orders")
                    return
                order_type = OrderType.Limit()
                price_raw = int(price * PRICE_PRECISION)

            order_params = OrderParams(
                order_type=order_type,
                market_type=MarketType.Perp(),
                direction=direction,
                base_asset_amount=base_amount_raw,
                price=price_raw,
                market_index=market_index,
            )
            
            sig = await drift_client.place_perp_order(order_params, sub_account_id=args.sub_account)
            print(f"Order placed successfully.")
            print(f"Signature: {sig}")
            
            log_transaction("trade", {
                "market": market_symbol, 
                "side": args.side, 
                "type": args.type,
                "amount": amount, 
                "price": price,
                "signature": str(sig)
            }, args.output_dir)

        elif args.command == "cancel":
             print("Cancelling orders...")
             # Drift SDK cancel_orders helper checks for market_type/market_index filter
             # If market is provided, filter.
             market_index = None
             market_type = None
             
             if args.market:
                market_symbol = args.market.upper()
                if not market_symbol.endswith("-PERP") and not market_symbol.isdigit():
                    market_symbol += "-PERP"
                
                market_conf = PERP_MARKET_MAP.get(market_symbol)
                # Try int
                if not market_conf:
                    try:
                        idx = int(args.market)
                        market_index = idx
                        market_type = MarketType.Perp() 
                    except:
                        pass
                else:
                    market_index = market_conf.market_index
                    market_type = MarketType.Perp()

             sig = await drift_client.cancel_orders(
                 market_type=market_type, 
                 market_index=market_index, 
                 sub_account_id=args.sub_account
             )
             print(f"Cancel signature: {sig}")
             
        elif args.command == "orders":
            user = DriftUser(drift_client, user_stats_pubkey=None, sub_account_id=args.sub_account)
            await user.subscribe()
            orders = user.get_user_account().orders
            print(f"Open Orders for Sub-account {args.sub_account}:")
            found = False
            for o in orders:
                if str(o.status) == "OrderStatus.Open()":
                    found = True
                    side = "Long" if str(o.direction) == "PositionDirection.Long()" else "Short"
                    type_ = str(o.order_type).split(".")[-1].replace("()","")
                    amount = o.base_asset_amount / BASE_PRECISION
                    price = o.price / PRICE_PRECISION
                    market_idx = o.market_index
                    # market_type = o.market_type # spot or perp
                    print(f"[{o.order_id}] {side} {type_} {amount} @ {price} (Market: {market_idx})")
            
            if not found:
                print("No open orders.")
            
            await user.unsubscribe()

    except Exception as e:
        print(f"Error executing {args.command}: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await drift_client.unsubscribe()
        await connection.close()

if __name__ == "__main__":
    asyncio.run(run_trader())
