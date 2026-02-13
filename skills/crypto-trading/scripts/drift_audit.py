#!/usr/bin/env python3.11
import os
import sys
import json
import asyncio
import argparse
from typing import Optional, Dict, Any, List
from solders.keypair import Keypair # type: ignore
from solders.pubkey import Pubkey # type: ignore
from driftpy.drift_client import DriftClient
from driftpy.constants.numeric_constants import QUOTE_PRECISION, BASE_PRECISION, PRICE_PRECISION
from driftpy.types import PositionDirection
from anchorpy import Wallet
from solana.rpc.async_api import AsyncClient

# Default path for records
DEFAULT_RECORDS_PATH = "/Users/veso/Documents/verso/Crypto"

async def audit_drift(rpc_url: str, pk_str: str, output_dir: str):
    drift_client = None
    connection = None
    try:
        if pk_str.startswith("[") or "," in pk_str:
            import ast
            raw_bytes = bytes(ast.literal_eval(pk_str))
            kp = Keypair.from_bytes(raw_bytes)
        elif len(pk_str) >= 64 and all(c in "0123456789abcdefABCDEF" for c in pk_str.replace("0x", "")):
            hex_str = pk_str[2:] if pk_str.startswith("0x") else pk_str
            kp = Keypair.from_seed(bytes.fromhex(hex_str[:64]))
        else:
            kp = Keypair.from_base58_string(pk_str)
        
        wallet = Wallet(kp)
        connection = AsyncClient(rpc_url)
        
        drift_client = DriftClient(connection, wallet, "mainnet")
        print(f"Subscribing to Drift for authority: {kp.pubkey()}...")
        await drift_client.subscribe()
        
        # Correct way to get user in 0.8.x
        user = drift_client.get_user(sub_account_id=0)
        await user.subscribe()
        
        user_account = user.get_user_account()
        
        positions = []
        market_names = {0: "SOL-PERP", 1: "BTC-PERP", 2: "ETH-PERP"}
        
        for p in user_account.perp_positions:
            if p.base_asset_amount != 0:
                asset_name = market_names.get(p.market_index, f"Market-{p.market_index}")
                size = p.base_asset_amount / BASE_PRECISION
                side = "Long" if size > 0 else "Short"
                
                mark_price = 0
                try:
                    oracle_data = drift_client.get_oracle_data_for_perp_market(p.market_index)
                    mark_price = oracle_data.price / PRICE_PRECISION
                except: pass

                positions.append({
                    "market_index": p.market_index,
                    "market_name": asset_name,
                    "side": side,
                    "size_base": abs(size),
                    "notional_vquote": p.quote_asset_amount / QUOTE_PRECISION,
                    "mark_price": mark_price
                })

        total_collateral = user.get_total_collateral() / QUOTE_PRECISION
        health = user.get_health()

        report = {
            "wallet_address": str(kp.pubkey()),
            "timestamp_iso": os.popen('date -u +"%Y-%m-%dT%H:%M:%SZ"').read().strip(),
            "total_collateral_usd": total_collateral,
            "health_factor": health,
            "perp_positions": positions,
            "sub_account_id": 0
        }
        
        os.makedirs(output_dir, exist_ok=True)
        timestamp_unix = int(os.popen('date +%s').read().strip())
        filename = f"drift_audit_{timestamp_unix}.json"
        filepath = os.path.join(output_dir, filename)
        
        with open(filepath, 'w') as f:
            json.dump(report, f, indent=2)
        
        latest_path = os.path.join(output_dir, "drift_audit_latest.json")
        if os.path.exists(latest_path): 
            try: os.remove(latest_path)
            except: pass
        try: os.symlink(filepath, latest_path)
        except: pass

        print(f"\nAudit completed successfully.")
        print(f"Report saved to: {filepath}")
        print(f"Health Factor: {health}")
        
        await user.unsubscribe()

    except Exception as e:
        print(f"Error during Drift audit: {e}")
        sys.exit(1)
    finally:
        if drift_client: await drift_client.unsubscribe()
        if connection: await connection.close()

def main():
    parser = argparse.ArgumentParser(description="Audit Drift Protocol positions.")
    parser.add_argument("--rpc", help="Solana RPC URL")
    parser.add_argument("--key", help="Private Key")
    parser.add_argument("--output-dir", default=DEFAULT_RECORDS_PATH, help="Directory to save records")
    args = parser.parse_args()
    
    config_path = os.path.expanduser("~/.verso/verso.json")
    rpc_url = args.rpc
    pk_str = args.key
    
    if (not rpc_url or not pk_str) and os.path.exists(config_path):
        with open(config_path, 'r') as f:
            conf = json.load(f)
            crypto_conf = conf.get('crypto', {})
            if not rpc_url: rpc_url = crypto_conf.get("solanaRpcUrl") or conf.get("SOLANA_RPC_URL")
            if not pk_str: pk_str = crypto_conf.get("solanaPrivateKey") or conf.get("SOLANA_PRIVATE_KEY")
            
    if not rpc_url: rpc_url = "https://api.mainnet-beta.solana.com"
    if not pk_str:
        print("Error: Private Key is required.")
        sys.exit(1)

    asyncio.run(audit_drift(rpc_url, pk_str, args.output_dir))

if __name__ == "__main__":
    main()
