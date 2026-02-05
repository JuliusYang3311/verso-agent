#!/usr/bin/env python3
import argparse
import base64
import json
import sys
import os
import time
import requests
from typing import Dict, Any, Optional
from solders.keypair import Keypair # type: ignore
from solders.pubkey import Pubkey # type: ignore
from solders.system_program import TransferParams, transfer
from solders.transaction import VersionedTransaction # type: ignore
from solders.message import to_bytes_versioned # type: ignore
from solana.rpc.api import Client

# Solana Tracker API
SOLANA_TRACKER_URL = "https://swap-v2.solanatracker.io/swap"
COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price"

# Robust Offline Token List
FALLBACK_TOKENS = [
    {"symbol": "SOL", "address": "So11111111111111111111111111111111111111112", "decimals": 9, "coingecko_id": "solana"},
    {"symbol": "USDC", "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "decimals": 6, "coingecko_id": "usd-coin"},
    {"symbol": "USDT", "address": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "decimals": 6, "coingecko_id": "tether"},
    {"symbol": "JUP", "address": "JUPyiwrYJFskUPiHa7hkeR8VZKJw32U4Ag5g6Nxbyh6", "decimals": 6, "coingecko_id": "jupiter-exchange-solana"},
    {"symbol": "BONK", "address": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "decimals": 5, "coingecko_id": "bonk"},
]

TOKENS = { t['symbol']: t['address'] for t in FALLBACK_TOKENS }
TOKEN_METADATA = { t['address']: {'symbol': t['symbol'], 'decimals': t['decimals'], 'cg_id': t.get('coingecko_id')} for t in FALLBACK_TOKENS }

def get_keypair(pk_str: str) -> Keypair:
    try:
        return Keypair.from_base58_string(pk_str)
    except:
        try: return Keypair.from_seed(bytes.fromhex(pk_str.replace("0x", "")))
        except: sys.exit(1)

# Helper: Dynamic Token Map (DexScreener discovery)
def get_token_map():
    t_map = {}
    for t in FALLBACK_TOKENS:
        t_map[t['address']] = {
            'symbol': t['symbol'], 
            'decimals': t['decimals'], 
            'cg_id': t.get('coingecko_id')
        }
    return t_map

def action_portfolio(rpc_url, keypair, proxies=None):
    pubkey = keypair.pubkey()
    print(f"Scanning Portfolio for {pubkey}...")
    
    global TOKEN_METADATA
    TOKEN_METADATA = get_token_map()
    
    sol_bal = 0.0
    try:
        payload = {"jsonrpc": "2.0", "id": 1, "method": "getBalance", "params": [str(pubkey)]}
        r = requests.post(rpc_url, json=payload, proxies=proxies).json()
        sol_bal = int(r['result']['value']) / 10**9
    except: pass
    holdings: Dict[str, float] = {"SOL": sol_bal}
    
    payload = {
        "jsonrpc": "2.0", "id": 1, "method": "getTokenAccountsByOwner",
        "params": [str(pubkey), {"programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"}, {"encoding": "jsonParsed"}]
    }
    try:
        r = requests.post(rpc_url, json=payload, proxies=proxies).json()
        if 'result' in r:
            for item in r['result']['value']:
                info = item['account']['data']['parsed']['info']
                mint, amt = info['mint'], info['tokenAmount']['uiAmount']
                if amt > 0:
                    data = TOKEN_METADATA.get(mint, {})
                    sym = data.get('symbol', mint)
                    holdings[sym] = amt
    except: pass
    
    prices: Dict[str, float] = {}
    sym_to_data: Dict[str, Dict[str, Optional[str]]] = {}
    cg_ids = []
    
    for sym in holdings.keys():
        found_mint = None
        for m, data in TOKEN_METADATA.items():
            if data['symbol'] == sym:
                found_mint = m
                cid = data.get('cg_id')
                if cid: cg_ids.append(cid)
                break
        
        mint_key = found_mint if found_mint else TOKENS.get(sym)
        sym_to_data[sym] = {'mint': mint_key}

    if cg_ids:
        try:
            ids_str = ",".join(cg_ids)
            r = requests.get(f"{COINGECKO_API}?ids={ids_str}&vs_currencies=usd", timeout=5, proxies=proxies).json()
            for cid, data in r.items():
                for m, meta in TOKEN_METADATA.items():
                    if meta.get('cg_id') == cid: prices[m] = float(data['usd'])
        except: pass

    missing_mints = []
    for sym, data in sym_to_data.items():
        m = data.get('mint')
        if m and m not in prices: missing_mints.append(m)

    if missing_mints:
        try:
            chunks = [missing_mints[i:i + 30] for i in range(0, len(missing_mints), 30)]
            for chunk in chunks:
                ds_url = f"https://api.dexscreener.com/latest/dex/tokens/{','.join(chunk)}"
                r = requests.get(ds_url, timeout=5, proxies=proxies).json()
                if 'pairs' in r:
                    for pair in r['pairs']:
                        m = pair['baseToken']['address']
                        if m not in prices: prices[m] = float(pair['priceUsd'])
                        if m not in TOKEN_METADATA:
                            sym = pair['baseToken']['symbol']
                            TOKEN_METADATA[m] = {'symbol': sym, 'decimals': 0}
                            if m in holdings:
                                holdings[sym] = holdings.pop(m)
                                sym_to_data[sym] = {'mint': m}
        except: pass

    total_usd = 0
    print("\nHoldings:")
    def get_val(item):
        s, a = item
        data = sym_to_data.get(s, {})
        m = data.get('mint', s)
        p = prices.get(m, 0.0)
        return a * p

    sorted_holdings = sorted(holdings.items(), key=get_val, reverse=True)

    for sym, amt in sorted_holdings:
        data = sym_to_data.get(sym, {})
        mint = data.get('mint', sym)
        p = prices.get(mint, 0.0)
        if p == 0:
             if sym in ["USDC", "USDT"]: p = 1.0
             elif sym == "SOL": p = 0 
        usd = amt * p
        total_usd += usd
        print(f"- {amt:.6f} {sym} (@ ${p:.4f}) = ${usd:.2f}")
    print(f"\nTotal Portfolio Value: ${total_usd:.2f}")

def action_swap(args, rpc_url, keypair: Keypair, proxies=None):
    token_in_raw = args.token_in
    token_out_raw = args.token_out
    
    token_in = TOKENS.get(token_in_raw.upper(), token_in_raw)
    token_out = TOKENS.get(token_out_raw.upper(), token_out_raw)
    
    amount = float(args.amount)
    slippage = args.slippage # Percent, e.g. 0.5
    
    # Solana Tracker uses decimal amounts directly (e.g. 0.1), no need to fetch decimals first for the request
    # but strictly requires 'from', 'to', 'amount', 'slippage'
    
    print(f"Fetching Quote & Transaction from Solana Tracker...")
    
    # Check for optional API key in environment
    api_key = os.environ.get("SOLANA_TRACKER_API_KEY")
    headers = {}
    if api_key:
        headers["x-api-key"] = api_key

    # Query params
    params = {
        "from": token_in,
        "to": token_out,
        "amount": amount,
        "slippage": slippage
    }
    
    # Handle Priority Fee
    if args.priority_fee:
        if args.priority_fee == "auto":
            # high/turbo/ultra etc. defaulting to high for safety
            params["priorityFee"] = "0.0005" # Default fixed or use specific API feature if available
            print("Using Priority Fee: 0.0005 SOL (Manual High)")
        else:
             # If user provided a number, solana tracker expects SOL value usually
             # assuming args.priority_fee is in micro-lamports? 
             # Solana Tracker API usually handles fees automatically or via 'priorityFee' param in SOL
             try:
                 fee_sol = float(args.priority_fee) / 10**9 
                 params["priorityFee"] = fee_sol
                 print(f"Using Priority Fee: {fee_sol:.6f} SOL")
             except: pass

    try:
        # Single call to get swap transaction (includes quote info usually)
        # Note: swap-v2 endpoint returns { txn, rate, ... }
        r = requests.get(SOLANA_TRACKER_URL, params=params, headers=headers, proxies=proxies, timeout=15)
        
        if r.status_code != 200:
            print(f"API Error ({r.status_code}): {r.text}")
            return

        data = r.json()
        
        # Parse Rate/Quote Info
        # 'rate' field usually contains price info
        rate = data.get('rate') # effective price
        
        # 'txn' is the base64 transaction
        txn_base64 = data.get('txn')
        
        if not txn_base64:
             print("Error: No transaction returned from API.")
             return

        print(f"\n--- Quote (Solana Tracker) ---")
        print(f"In:  {amount} {args.token_in}")
        # Estimating out based on rate if explicit outAmount not provided in top level
        # Tracker V2 usually just returns txn. We can infer verify strictly on chain or trust the blind sign for CLI simplification
        print(f"Rate: {rate} (Estimated)")
        
        if args.quote_only: return

        # Confirmation
        if input(f"\nConfirm SWAP? (y/n): ").lower() != 'y':
            print("Cancelled.")
            return

        # Deserialize and Sign
        raw_tx = base64.b64decode(txn_base64)
        tx = VersionedTransaction.from_bytes(raw_tx)
        
        signature = keypair.sign_message(to_bytes_versioned(tx.message))
        signed_tx = VersionedTransaction.populate(tx.message, [signature])
        
        # Send
        print("Sending transaction...")
        res = Client(rpc_url).send_raw_transaction(bytes(signed_tx))
        
        print(f"Transaction Sent! Signature: {res.value}")
        print(f"Explorer: https://solscan.io/tx/{res.value}")
        
    except Exception as e:
        print(f"Swap Failed: {e}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True, choices=["portfolio", "monitor", "balance", "swap", "quote", "transfer"])
    parser.add_argument("--rpc", default="https://api.mainnet-beta.solana.com")
    parser.add_argument("--token-in")
    parser.add_argument("--token-out")
    parser.add_argument("--amount")
    parser.add_argument("--slippage", type=float, default=0.5, help="Slippage %% (default 0.5)")
    parser.add_argument("--priority-fee", help="Priority fee in micro-lamports or 'auto'")
    parser.add_argument("--quote-only", action="store_true")
    
    args, unknown = parser.parse_known_args()
    
    # Load Config (Standard Verso Path)
    config_path = os.path.expanduser("~/.verso/verso.json")
    try:
        if not os.path.exists(config_path):
             # Fallback to local relative for dev
             config_path = "verso.json" 
        
        with open(config_path) as f:
            full_config = json.load(f)
            config = full_config.get('crypto', {})
            
        pk = config.get('solanaPrivateKey')
        if not pk: raise Exception("No solanaPrivateKey in config")
        
        proxies = None
        
        rpc = config.get('solanaRpcUrl')
        if not rpc:
            alchemy_key = config.get('alchemyApiKey')
            if alchemy_key:
                rpc = f"https://solana-mainnet.g.alchemy.com/v2/{alchemy_key}"
            else:
                rpc = args.rpc
                
        # Load optional API key for Tracker
        if 'solanaTrackerApiKey' in config:
            os.environ["SOLANA_TRACKER_API_KEY"] = config['solanaTrackerApiKey']
            
    except Exception as e:
        print(f"Config Error: {e}")
        print("Please run 'verso configure' to set up wallet.")
        sys.exit(1)
    
    kp = get_keypair(pk)
    
    if args.action == "portfolio": action_portfolio(rpc, kp, proxies)
    elif args.action in ["swap", "quote"]: 
        if not args.token_in or not args.token_out or not args.amount:
            print("Error: --token-in, --token-out, and --amount required for swap/quote")
            sys.exit(1)
        action_swap(args, rpc, kp, proxies)
    elif args.action == "monitor":
        while True:
            action_portfolio(rpc, kp, proxies)
            time.sleep(10)

if __name__ == "__main__":
    main()
