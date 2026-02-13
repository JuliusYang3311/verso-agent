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
from driftpy.drift_user import DriftUser
from driftpy.constants.numeric_constants import QUOTE_PRECISION, BASE_PRECISION, PRICE_PRECISION
from driftpy.types import PositionDirection, SpotPosition
from driftpy.math.spot_position import get_token_amount
from anchorpy import Wallet
from solana.rpc.async_api import AsyncClient

from driftpy.constants.spot_markets import mainnet_spot_market_configs

# Default path for records as per requirements
DEFAULT_RECORDS_PATH = "/Users/veso/Documents/verso/Crypto"

# Build dynamic maps from Drift constants
SPOT_MARKET_MAP = {m.market_index: m for m in mainnet_spot_market_configs}

async def audit_drift(rpc_url: str, pk_str: str, output_dir: str):
    """
    Connects to Drift Protocol, retrieves perp and spot positions, and saves a JSON report.
    """
    drift_client = None
    connection = None
    try:
        # 1. Initialize Keypair and Wallet
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
        
        # 2. Initialize Drift Client
        drift_client = DriftClient(
            connection,
            wallet,
            "mainnet"
        )
        
        print(f"Subscribing to Drift for authority: {kp.pubkey()}...")
        await drift_client.subscribe()
        
        # Drift allows multiple sub-accounts. Default is 0.
        user = DriftUser(drift_client, user_stats_pubkey=None, sub_account_id=0)
        await user.subscribe()
        
        user_account = user.get_user_account()
        
        # 3. Process Perp Positions
        perp_positions = []
        perp_market_names = {0: "SOL-PERP", 1: "BTC-PERP", 2: "ETH-PERP"}
        
        for p in user_account.perp_positions:
            if p.base_asset_amount != 0:
                asset_name = perp_market_names.get(p.market_index, f"Perp-{p.market_index}")
                
                size = p.base_asset_amount / BASE_PRECISION
                side = "Long" if size > 0 else "Short"
                
                mark_price = 0
                try:
                    oracle_data = drift_client.get_oracle_data_for_perp_market(p.market_index)
                    mark_price = oracle_data.price / PRICE_PRECISION
                except:
                    pass

                perp_positions.append({
                    "market_index": p.market_index,
                    "market_name": asset_name,
                    "side": side,
                    "size_base": abs(size),
                    "notional_vquote": p.quote_asset_amount / QUOTE_PRECISION,
                    "mark_price": mark_price,
                    "pnl_quote": p.quote_asset_amount / QUOTE_PRECISION # simplified pnl
                })

        # 4. Process Spot Positions
        spot_positions = []
        for p in user_account.spot_positions:
            if p.scaled_balance != 0:
                market_conf = SPOT_MARKET_MAP.get(p.market_index)
                precision = 10**market_conf.decimals if market_conf else 10**6
                symbol = market_conf.symbol if market_conf else f"Spot-{p.market_index}"
                
                spot_market = await drift_client.get_spot_market_account(p.market_index)
                
                token_amount = get_token_amount(p.scaled_balance, spot_market, p.balance_type)
                human_amount = token_amount / precision
                
                side = "Deposit" if str(p.balance_type) == "SpotBalanceType.Deposit()" else "Borrow"
                
                spot_positions.append({
                    "market_index": p.market_index,
                    "market_name": symbol,
                    "side": side,
                    "amount": human_amount,
                    "balance_type": str(p.balance_type)
                })

        total_collateral = user.get_total_collateral() / QUOTE_PRECISION
        total_account_value = user.get_total_asset_value() / QUOTE_PRECISION
        total_perp_pnl = user.get_unrealized_pnl(False, None, None) / QUOTE_PRECISION
        leverage = user.get_leverage() / 10_000 # leverage is scaled by 10k usually in SDK or just check return type. 
        # Actually driftpy get_leverage returns scaled? checking source or assuming standard 10000 representation for percentages in protocol, 
        # but sdk usually returns float? 
        # get_leverage() in python sdk: (total_liability / total_asset_value) * 10_000. So we divide by 10000.
        
        health = user.get_health()

        report = {
            "wallet_address": str(kp.pubkey()),
            "timestamp_iso": os.popen('date -u +"%Y-%m-%dT%H:%M:%SZ"').read().strip(),
            "total_account_value_usd": total_account_value,
            "total_collateral_usd": total_collateral,
            "unrealized_pnl_usd": total_perp_pnl,
            "leverage": leverage,
            "health_factor": health,
            "perp_positions": perp_positions,
            "spot_positions": spot_positions,
            "sub_account_id": 0
        }
        
        # 5. Save to Records
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
        print(f"Account Value: ${total_account_value:.2f}")
        print(f"Unrealized PnL: ${total_perp_pnl:.2f}")
        print(f"Leverage: {leverage:.2f}x")
        print(f"Health Factor: {health}")
        
        await user.unsubscribe()

    except Exception as e:
        print(f"Error during Drift audit: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        if drift_client:
            await drift_client.unsubscribe()
        if connection:
            await connection.close()

def main():
    parser = argparse.ArgumentParser(description="Audit Drift Protocol positions.")
    parser.add_argument("--rpc", help="Solana RPC URL")
    parser.add_argument("--key", help="Private Key (Base58, Hex, or [u8] array)")
    parser.add_argument("--output-dir", default=DEFAULT_RECORDS_PATH, help="Directory to save records")
    
    args = parser.parse_args()
    
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

    asyncio.run(audit_drift(rpc_url, pk_str, args.output_dir))

if __name__ == "__main__":
    main()
