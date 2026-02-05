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

# Constants
JUPITER_QUOTE_API = "https://api.jup.ag/swap/v1/quote"
JUPITER_SWAP_API = "https://api.jup.ag/swap/v1/swap"
JUPITER_PRICE_API = "https://api.jup.ag/price/v2"

# Robust Offline Token List
FALLBACK_TOKENS = [
    {"symbol": "SOL", "address": "So11111111111111111111111111111111111111112", "decimals": 9},
    {"symbol": "USDC", "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "decimals": 6},
    {"symbol": "USDT", "address": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "decimals": 6},
    {"symbol": "JUP", "address": "JUPyiwrYJFskUPiHa7hkeR8VZKJw32U4Ag5g6Nxbyh6", "decimals": 6},
    {"symbol": "BONK", "address": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "decimals": 5},
]

TOKENS = { t['symbol']: t['address'] for t in FALLBACK_TOKENS }
TOKEN_METADATA = { t['address']: {'symbol': t['symbol'], 'decimals': t['decimals']} for t in FALLBACK_TOKENS }
JUP_KEY_HEADER = {}

def get_keypair(pk_str: str) -> Keypair:
    try:
        return Keypair.from_base58_string(pk_str)
    except:
        try: return Keypair.from_seed(bytes.fromhex(pk_str.replace("0x", "")))
        except: sys.exit(1)

# Helper: Dynamic Token Map
def get_token_map():
    # Start with fallback
    t_map = { t['address']: {'symbol': t['symbol'], 'decimals': t['decimals']} for t in FALLBACK_TOKENS }
    
    # Try fetching full list
    try:
        r = requests.get("https://token.jup.ag/strict", timeout=3)
        if r.status_code == 200:
            for item in r.json():
                t_map[item['address']] = {'symbol': item['symbol'], 'decimals': item['decimals']}
    except:
        # DNS failure or timeout - ignore (Fix 1: Silence "Fake Alarm")
        pass 
    return t_map

def action_portfolio(rpc_url, keypair: Keypair):
    pubkey = keypair.pubkey()
    print(f"Scanning Portfolio for {pubkey}...")
    
    # Reload metadata dynamically
    global TOKEN_METADATA
    TOKEN_METADATA = get_token_map()
    
    # 1. Native SOL (Fix 2: Raw RPC to avoid "data did not match" errors)
    sol_bal = 0
    try:
        payload = {"jsonrpc": "2.0", "id": 1, "method": "getBalance", "params": [str(pubkey)]}
        r = requests.post(rpc_url, json=payload).json()
        sol_bal = int(r['result']['value']) / 10**9
    except: pass
    holdings = {"SOL": sol_bal}
    
    # 2. Tokens via direct JSON-RPC
    payload = {
        "jsonrpc": "2.0", "id": 1, "method": "getTokenAccountsByOwner",
        "params": [str(pubkey), {"programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"}, {"encoding": "jsonParsed"}]
    }
    try:
        r = requests.post(rpc_url, json=payload).json()
        if 'result' in r:
            for item in r['result']['value']:
                info = item['account']['data']['parsed']['info']
                mint, amt = info['mint'], info['tokenAmount']['uiAmount']
                if amt > 0:
                    sym = TOKEN_METADATA.get(mint, {}).get('symbol', mint)
                    holdings[sym] = amt
    except: pass
    
    # 3. Prices via Jupiter V2 -> DexScreener Fallback (Fix 3: Navigation Jam)
    prices = {}
    mints = []
    
    # Resolve symbols back to mints for price fetching
    sym_to_mint = {}
    for sym in holdings.keys():
        # Find mint in fallback or map
        found_mint = None
        for m, data in TOKEN_METADATA.items():
            if data['symbol'] == sym:
                found_mint = m
                break
        if not found_mint: found_mint = TOKENS.get(sym) 
        if found_mint:
            mints.append(found_mint)
            sym_to_mint[sym] = found_mint

    # Try Jupiter first
    try:
        if mints:
            ids_str = ",".join(mints)
            r = requests.get(f"{JUPITER_PRICE_API}?ids={ids_str}", headers=JUP_KEY_HEADER, timeout=5).json()
            if 'data' in r: 
                for m, data in r['data'].items():
                    if data: prices[m] = float(data['price'])
    except: pass
    
    # Fallback: DexScreener (if prices missing)
    missing_mints = [m for m in mints if m not in prices]
    if missing_mints:
        try:
            # Chunking for DexScreener (max 30 addresses usually safe)
            chunks = [missing_mints[i:i + 30] for i in range(0, len(missing_mints), 30)]
            for chunk in chunks:
                ds_url = f"https://api.dexscreener.com/latest/dex/tokens/{','.join(chunk)}"
                r = requests.get(ds_url, timeout=5).json()
                if 'pairs' in r:
                    for pair in r['pairs']:
                        m = pair['baseToken']['address']
                        # Backfill Price
                        if m not in prices: 
                            prices[m] = float(pair['priceUsd'])
                        # Backfill Metadata (Symbol) specifically for dynamic discovery
                        if m not in TOKEN_METADATA:
                            sym = pair['baseToken']['symbol']
                            TOKEN_METADATA[m] = {'symbol': sym, 'decimals': 0} # Decimals unknown but not needed for display
                            # Update holdings key from Mint -> Symbol if it was waiting
                            if m in holdings:
                                holdings[sym] = holdings.pop(m)
                                sym_to_mint[sym] = m
        except: pass

    total_usd = 0
    print("\nHoldings:")
    # Re-sort to show valuable assets first
    def get_val(item):
        s, a = item
        m = sym_to_mint.get(s, s) # Handle case where s is mint
        p = prices.get(m, 0.0)
        return a * p

    sorted_holdings = sorted(holdings.items(), key=get_val, reverse=True)

    for sym, amt in sorted_holdings:
        mint = sym_to_mint.get(sym, sym) # Fallback to sym if it is the mint
        p = prices.get(mint, 0.0)
        
        # Hardcoded stablecoin assumption if price fails
        if p == 0:
             if sym in ["USDC", "USDT"]: p = 1.0
             elif sym == "SOL": p = 0 # Don't assume SOL price if API fails completely to avoid confusion

        usd = amt * p
        total_usd += usd
        print(f"- {amt:.6f} {sym} (@ ${p:.4f}) = ${usd:.2f}")
    print(f"\nTotal Portfolio Value: ${total_usd:.2f}")

def action_swap(args, rpc_url, keypair: Keypair):
    token_in = TOKENS.get(args.token_in.upper(), args.token_in)
    token_out = TOKENS.get(args.token_out.upper(), args.token_out)
    dec = TOKEN_METADATA.get(token_in, {}).get('decimals', 6)
    amt_atoms = int(float(args.amount) * (10**dec))
    
    q_url = f"{JUPITER_QUOTE_API}?inputMint={token_in}&outputMint={token_out}&amount={amt_atoms}&slippageBps={int(args.slippage*100)}"
    try:
        quote = requests.get(q_url, headers=JUP_KEY_HEADER).json()
        if "error" in quote: return print(f"Quote Error: {quote['error']}")
        print(f"Quote received: In={quote['inAmount']} Out={quote['outAmount']}")
        if args.quote_only: return
        
        # Swap
        swap_resp = requests.post(JUPITER_SWAP_API, headers=JUP_KEY_HEADER, json={"userPublicKey": str(keypair.pubkey()), "quoteResponse": quote}).json()
        raw_tx = base64.b64decode(swap_resp['swapTransaction'])
        tx = VersionedTransaction.from_bytes(raw_tx)
        signature = keypair.sign_message(to_bytes_versioned(tx.message))
        signed_tx = VersionedTransaction.populate(tx.message, [signature])
        res = Client(rpc_url).send_transaction(signed_tx)
        print(f"Executed! Sig: {res.value}")
    except Exception as e: print(f"Swap Failed: {e}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True)
    parser.add_argument("--rpc", default="https://api.mainnet-beta.solana.com")
    parser.add_argument("--token-in")
    parser.add_argument("--token-out")
    parser.add_argument("--amount")
    parser.add_argument("--slippage", type=float, default=0.5)
    parser.add_argument("--quote-only", action="store_true")
    args = parser.parse_args()
    
    config_path = "/Users/veso/.verso/verso.json"
    config = json.load(open(config_path))['crypto']
    pk = config['solanaPrivateKey']
    rpc = config.get('solanaRpcUrl', args.rpc)
    
    global JUP_KEY_HEADER
    if config.get('jupiterApiKey'):
        JUP_KEY_HEADER = {"x-api-key": config['jupiterApiKey']}
    
    kp = get_keypair(pk)
    if args.action == "portfolio": action_portfolio(rpc, kp)
    elif args.action in ["swap", "quote"]: action_swap(args, rpc, kp)

if __name__ == "__main__":
    main()
