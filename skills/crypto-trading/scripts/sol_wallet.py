#!/usr/bin/env python3
import argparse
import base64
import json
import sys
import time
import requests
from solders.keypair import Keypair # type: ignore
from solders.pubkey import Pubkey # type: ignore
from solders.system_program import TransferParams, transfer
from solders.transaction import VersionedTransaction # type: ignore
from solders.message import to_bytes_versioned # type: ignore
from solana.rpc.api import Client

# Public Aggregator API (No Auth Required)
QUOTE_API = "https://quote-api.jup.ag/v6/quote"
SWAP_API = "https://quote-api.jup.ag/v6/swap"
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
    holdings = {"SOL": sol_bal}
    
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
    
    prices = {}
    sym_to_data = {}
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
    
    # Try to find decimals from metadata or on-chain
    dict_in = TOKEN_METADATA.get(token_in, {})
    dec = dict_in.get('decimals')
    if dec is None:
        print(f"Warning: Decimals for {args.token_in} unknown, assuming 6. Use generic mints at own risk.")
        dec = 6
        
    amt_atoms = int(float(args.amount) * (10**dec))
    slippage_bps = int(args.slippage * 100)
    
    print(f"Fetching Quote via DEX Aggregator...")
    # Public V6 API uses slightly different params if needed, but standard quote is same
    q_url = f"{QUOTE_API}?inputMint={token_in}&outputMint={token_out}&amount={amt_atoms}&slippageBps={slippage_bps}"
    try:
        # No headers needed for Public API
        quote = requests.get(q_url, timeout=10, proxies=proxies).json()
        if "error" in quote: return print(f"Quote Error: {quote['error']}")
        
        in_amt = int(quote['inAmount']) / (10**dec)
        out_amt_raw = int(quote['outAmount'])
        
        dict_out = TOKEN_METADATA.get(token_out, {})
        out_dec = dict_out.get('decimals', 6)
        out_amt = out_amt_raw / (10**out_dec)
        
        print(f"\n--- Quote ---")
        print(f"In:  {in_amt} {args.token_in}")
        print(f"Out: {out_amt} {args.token_out}")
        print(f"Price Impact: {quote.get('priceImpactPct', '0')}%")
        
        if args.quote_only: return

        # Confirmation
        if input(f"\nConfirm SWAP? (y/n): ").lower() != 'y':
            print("Cancelled.")
            return

        # Prepare Swap Request
        body = {
            "userPublicKey": str(keypair.pubkey()),
            "quoteResponse": quote,
            "wrapAndUnwrapSol": True
        }
        
        # Priority Fee
        if args.priority_fee:
            if args.priority_fee == "auto":
                body["computeUnitPriceMicroLamports"] = "auto"
                print("Using Dynamic Priority Fee (Auto)")
            else:
                  body["computeUnitPriceMicroLamports"] = int(args.priority_fee)
                  print(f"Using Priority Fee: {args.priority_fee} micro-lamports")

        swap_resp = requests.post(SWAP_API, json=body, timeout=15, proxies=proxies).json()
        
        if "error" in swap_resp: return print(f"Swap Build Error: {swap_resp['error']}")
        
        raw_tx = base64.b64decode(swap_resp['swapTransaction'])
        tx = VersionedTransaction.from_bytes(raw_tx)
        
        # Sign
        signature = keypair.sign_message(to_bytes_versioned(tx.message))
        signed_tx = VersionedTransaction.populate(tx.message, [signature])
        
        # Send
        print("Sending transaction...")
        opts =  {"skipPreflight": True}
        res = Client(rpc_url).send_transaction(signed_tx, opts=opts)
        
        print(f"Transaction Sent! Signature: {res.value}")
        print(f"Explorer: https://solscan.io/tx/{res.value}")
        
    except Exception as e: print(f"Swap Failed: {e}")

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
    # ... other args ...
    args, unknown = parser.parse_known_args() # For safety
    
    config_path = "/Users/veso/.verso/verso.json"
    try:
        config = json.load(open(config_path))['crypto']
        pk = config['solanaPrivateKey']
        
        # Proxy Configuration
        proxy_url = config.get('proxy')
        proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None
        
        # Dynamic RPC URL construction
        rpc = config.get('solanaRpcUrl')
        if not rpc:
            alchemy_key = config.get('alchemyApiKey')
            if alchemy_key:
                rpc = f"https://solana-mainnet.g.alchemy.com/v2/{alchemy_key}"
            else:
                rpc = args.rpc # Default fallbacks
    except:
        print("Error loading config. Run 'verso configure'.")
        sys.exit(1)
    
    kp = get_keypair(pk)
    
    if args.action == "portfolio": action_portfolio(rpc, kp, proxies)
    elif args.action in ["swap", "quote"]: 
        if not args.token_in or not args.token_out or not args.amount:
            print("Error: --token-in, --token-out, and --amount required for swap/quote")
            sys.exit(1)
        action_swap(args, rpc, kp, proxies)
    elif args.action == "monitor":
        print("Monitor mode...")
        # (Simplified monitor logic or just call portfolio in loop)
        while True:
            action_portfolio(rpc, kp, proxies)
            time.sleep(10)

if __name__ == "__main__":
    main()
