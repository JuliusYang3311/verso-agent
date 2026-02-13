#!/usr/bin/env python3.11
import os
import sys
import json
import asyncio
import argparse
from typing import Optional, Dict, Any
from solders.keypair import Keypair # type: ignore
from driftpy.drift_client import DriftClient
from driftpy.constants.spot_markets import mainnet_spot_market_configs
from anchorpy import Wallet
from solana.rpc.async_api import AsyncClient

# Default path for records
DEFAULT_RECORDS_PATH = "/Users/veso/Documents/verso/Crypto"

SPOT_MARKET_MAP = {m.symbol: m for m in mainnet_spot_market_configs}

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

async def run_transfer():
    parser = argparse.ArgumentParser(description="Drift Protocol Transfer (Deposit/Withdraw)")
    parser.add_argument("action", choices=["deposit", "withdraw"], help="Action to perform")
    parser.add_argument("--amount", type=float, required=True, help="Amount to transfer")
    parser.add_argument("--asset", required=True, help="Asset symbol (e.g. USDC, SOL)")
    parser.add_argument("--sub-account", type=int, default=0, help="Drift sub-account ID")
    parser.add_argument("--rpc", help="Solana RPC URL")
    parser.add_argument("--key", help="Private Key")
    parser.add_argument("--output-dir", default=DEFAULT_RECORDS_PATH, help="Directory to save logs")
    
    args = parser.parse_args()

    # Resolve Asset
    market_conf = SPOT_MARKET_MAP.get(args.asset.upper())
    if not market_conf:
        print(f"Error: Unknown asset '{args.asset}'. Available: {', '.join(list(SPOT_MARKET_MAP.keys())[:10])}...")
        sys.exit(1)
        
    market_index = market_conf.market_index
    precision = 10**market_conf.decimals
    amount_raw = int(args.amount * precision)

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
        if args.action == "deposit":
            print(f"Depositing {args.amount} {args.asset} to sub-account {args.sub_account}...")
            sig = await drift_client.deposit(
                amount_raw,
                market_index,
                kp.pubkey(), # Use default associated token account from wallet
                sub_account_id=args.sub_account
            )
            print(f"Deposit signature: {sig}")
            log_transaction("deposit", {"asset": args.asset, "amount": args.amount, "signature": str(sig)}, args.output_dir)

        elif args.action == "withdraw":
            print(f"Withdrawing {args.amount} {args.asset} from sub-account {args.sub_account}...")
            sig = await drift_client.withdraw(
                amount_raw,
                market_index,
                kp.pubkey(), # Target wallet
                sub_account_id=args.sub_account
            )
            print(f"Withdraw signature: {sig}")
            log_transaction("withdraw", {"asset": args.asset, "amount": args.amount, "signature": str(sig)}, args.output_dir)

    except Exception as e:
        print(f"Error executing {args.action}: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await drift_client.unsubscribe()
        await connection.close()

if __name__ == "__main__":
    asyncio.run(run_transfer())
