#!/usr/bin/env python3.11
import os
import sys
import json
import asyncio
import argparse
from typing import Optional, Dict, Any
from solders.keypair import Keypair # type: ignore
from driftpy.drift_client import DriftClient
from driftpy.drift_user import DriftUser
from driftpy.constants.numeric_constants import QUOTE_PRECISION
from anchorpy import Wallet
from solana.rpc.async_api import AsyncClient

# Default path for records
DEFAULT_RECORDS_PATH = "/Users/veso/Documents/verso/Crypto"

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

async def run_leverage():
    parser = argparse.ArgumentParser(description="Drift Protocol Leverage Manager")
    parser.add_argument("action", choices=["check", "update"], help="Action: check current leverage or update settings")
    parser.add_argument("--max-leverage", type=float, help="Max leverage setting (for update)")
    parser.add_argument("--sub-account", type=int, default=0, help="Drift sub-account ID")
    parser.add_argument("--rpc", help="Solana RPC URL")
    parser.add_argument("--key", help="Private Key")
    
    args = parser.parse_args()

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
    
    user = DriftUser(drift_client, user_stats_pubkey=None, sub_account_id=args.sub_account)
    await user.subscribe()
    
    try:
        current_leverage = user.get_leverage() / 10_000
        
        # Drift V2 doesn't have a direct "set max leverage" on-chain param in the simplified sense
        # It's usually controlled by margin weights of assets.
        # But we can update the margin ratio if we are a custom user or delegate.
        # For standard users, "setting leverage" usually means just monitoring it or opening positions up to a limit.
        # However, we can check "Max Leverage" possible based on maintenance margin.
        
        maintenance_margin_req = user.get_maintenance_margin_requirement()
        initial_margin_req = user.get_initial_margin_requirement()
        total_collateral = user.get_total_collateral()
        
        max_leverage_maintenance = (total_collateral / maintenance_margin_req) if maintenance_margin_req > 0 else 0
        
        print(f"Sub-account: {args.sub_account}")
        print(f"Current Leverage: {current_leverage:.2f}x")
        print(f"Total Collateral: ${total_collateral / QUOTE_PRECISION:.2f}")
        
        if args.action == "update":
            # Since we can't easily "set" a hard cap on-chain without custom logic, 
            # we'll just implement a helper to update margin stress testing or delegated keys if needed.
            # For now, we'll treat this as a "Configuration update" placeholder or "Update User Custom Margin Ratio" if supported.
            # Looking at SDK, `update_user_margin_trading_enabled` is a thing.
            
            # For this task, "Setting Leverage" might imply opening a position with target leverage.
            # But since this is a separate script `drift_leverage.py`, maybe it's about changing account config.
            # Let's support `update_margin_trading_enabled` toggling as a proxy for "enable/disable leverage".
            
            if args.max_leverage:
                 print("Note: Drift Protocol manages leverage via asset weights. This script currently only reports leverage capabilities.")
                 print(f"To open a position with {args.max_leverage}x, use 'drift_trader.py trade --leverage {args.max_leverage} ...'")

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await user.unsubscribe()
        await drift_client.unsubscribe()
        await connection.close()

if __name__ == "__main__":
    asyncio.run(run_leverage())
