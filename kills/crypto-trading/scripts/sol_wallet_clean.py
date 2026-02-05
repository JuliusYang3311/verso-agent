#!/usr/bin/env python3
import argparse
import base64
import json
import sys
import requests
from solders.keypair import Keypair # type: ignore
from solders.pubkey import Pubkey # type: ignore
from solders.transaction import VersionedTransaction # type: ignore
from solders.message import to_bytes_versioned # type: ignore
from solana.rpc.api import Client

# --- Core Configuration ---
JUP_QUOTE_API = "https://quote-api.jup.ag/v6/quote"
JUP_SWAP_API = "https://quote-api.jup.ag/v6/swap"
COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price"

# --- Token Metadata ---
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

def action_portfolio(rpc_url, keypair: Keypair):
    pubkey = keypair.pubkey()
    print(f"Scanning Portfolio for {pubkey}...")
    
    # SOL Balance
    sol_bal = 0.0
    try:
        payload = {"jsonrpc": "2.0", "id": 1, "method": "getBalance", "params": [str(pubkey)]}
        r = requests.post(rpc_url, json=payload).json()
        sol_bal = int(r['result']['value']) / 10**9
    except: pass
    
    holdings = {"SOL": sol_bal}
    
    # Token Balances
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
                    data = TOKEN_METADATA.get(mint, {})
                    sym = data.get('symbol', mint)
                    holdings[sym] = amt
    except: pass
    
    # Prices
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
            r = requests.get(f"{COINGECKO_API}?ids={ids_str}&vs_currencies=usd", timeout=5).json()
            for cid, data in r.items():
                for m, meta in TOKEN_METADATA.items():
                    if meta.get('cg_id') == cid: prices[m] = float(data['usd'])
        except: pass

    # Calculate Total
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

def action_swap(args, rpc_url, keypair: Keypair):
    token_in = args.token_in
    token_out = args.token_out
    
    # Resolve Address
    token_in = TOKENS.get(token_in.upper(), token_in)
    token_out = TOKENS.get(token_out.upper(), token_out)
    
    try:
        amount = float(args.amount)
    except ValueError:
        print("Error: Invalid amount")
        return

    # Get Decimals
    dict_in = TOKEN_METADATA.get(token_in, {})
    dec = dict_in.get('decimals')
    if dec is None:
        print(f"Warning: Decimals for {args.token_in} unknown, assuming 6.")
        dec = 6
        
    amt_atoms = int(amount * (10**dec))
    slippage_bps = int(args.slippage * 100)
    
    print(f"Fetching Quote via Jupiter V6...")
    
    # Prepare Quote Request
    q_url = f"{JUP_QUOTE_API}?inputMint={token_in}&outputMint={token_out}&amount={amt_atoms}&slippageBps={slippage_bps}"
    
    # Load API Key
    try:
        config_path = "/Users/veso/.verso/verso.json"
        with open(config_path) as f:
            config = json.load(f)['crypto']
            jup_key = config.get('jupiterApiKey')
            
        if not jup_key:
            print("Error: Jupiter API Key not found in config. Please run 'verso configure' or add 'jupiterApiKey' to crypto section.")
            return
            
        headers = {"x-api-key": jup_key}
        
        quote_resp = requests.get(q_url, timeout=10, headers=headers).json()
        
        if "error" in quote_resp:
            print(f"Quote Error: {quote_resp['error']}")
            return
            
        # Parse Quote
        in_amt = int(quote_resp['inAmount']) / (10**dec)
        out_amt = int(quote_resp['outAmount'])
        
        dict_out = TOKEN_METADATA.get(token_out, {})
        out_dec = dict_out.get('decimals', 6)
        out_amt = out_amt / (10**out_dec)
        
        print(f"\n--- Quote ---")
        print(f"In: {in_amt} {args.token_in}")
        print(f"Out: {out_amt} {args.token_out}")
        print(f"Price Impact: {quote_resp.get('priceImpactPct', '0')}%")
        
        if args.quote_only:
            return

        # Confirm
        if input(f"\nConfirm SWAP? (y/n): ").lower() != 'y':
            print("Cancelled.")
            return

        # Prepare Swap Request
        body = {
            "userPublicKey": str(keypair.pubkey()),
            "quoteResponse": quote_resp,
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

        swap_resp = requests.post(JUP_SWAP_API, json=body, timeout=15, headers=headers).json()
        
        if "error" in swap_resp:
            print(f"Swap Error: {swap_resp['error']}")
            return
        
        # Sign and Send
        raw_tx = base64.b64decode(swap_resp['swapTransaction'])
        tx = VersionedTransaction.from_bytes(raw_tx)
        
        signature = keypair.sign_message(to_bytes_versioned(tx.message))
        signed_tx = VersionedTransaction.populate(tx.message, [signature])
        
        print("Sending transaction...")
        res = Client(rpc_url).send_raw_transaction(bytes(signed_tx))
        
        print(f"Transaction Sent! Signature: {res.value}")
        print(f"Explorer: https://solscan.io/tx/{res.value}")
        
    except Exception as e:
        print(f"Swap Failed: {e}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True, choices=["portfolio", "monitor", "swap", "quote"])
    parser.add_argument("--rpc", default="https://api.mainnet-beta.solana.com")
    parser.add_argument("--token-in")
    parser.add_argument("--token-out")
    parser.add_argument("--amount")
    parser.add_argument("--slippage", type=float, default=0.5, help="Slippage %% (default 0.5)")
    parser.add_argument("--priority-fee", help="Priority fee in micro-lamports or 'auto'")
    parser.add_argument("--quote-only", action="store_true")
    
    args = parser.parse_args()
    
    # Load Config
    config_path = "/Users/veso/.verso/verso.json"
    try:
        with open(config_path) as f:
            full_config = json.load(f)
            config = full_config.get('crypto', {})
            
        pk = config.get('solanaPrivateKey')
        if not pk: raise Exception("No solanaPrivateKey found")
        
        rpc = config.get('solanaRpcUrl')
        if not rpc:
            alchemy_key = config.get('alchemyApiKey')
            if alchemy_key:
                rpc = f"https://solana-mainnet.g.alchemy.com/v2/{alchemy_key}"
            else:
                rpc = args.rpc
    
    except Exception as e:
        print(f"Error loading config: {e}")
        sys.exit(1)
    
    kp = get_keypair(pk)
    
    if args.action == "portfolio": action_portfolio(rpc, kp)
    elif args.action in ["swap", "quote"]: 
        if not args.token_in or not args.token_out or not args.amount:
            print("Error: --token-in, --token-out, and --amount required for swap/quote")
            sys.exit(1)
        action_swap(args, rpc, kp)
    elif args.action == "monitor":
        print("Monitor mode...")
        while True:
            action_portfolio(rpc, kp)
            time.sleep(10)

if __name__ == "__main__":
    main()
