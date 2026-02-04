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
from solana.rpc.types import TxOpts, TokenAccountOpts

import functools

# Constants (Jupiter V6+ Authentication Required)
JUPITER_QUOTE_API = "https://api.jup.ag/swap/v1/quote"
JUPITER_SWAP_API = "https://api.jup.ag/swap/v1/swap"
JUPITER_PRICE_API = "https://api.jup.ag/price/v2"
JUPITER_TOKEN_API = "https://api.jup.ag/tokens/v1/strict"

# Validated Token List (Fallback)
FALLBACK_TOKENS = [
    {"symbol": "SOL", "address": "So11111111111111111111111111111111111111112", "decimals": 9},
    {"symbol": "USDC", "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "decimals": 6},
    {"symbol": "USDT", "address": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "decimals": 6},
    {"symbol": "JUP", "address": "JUPyiwrYJFskUPiHa7hkeR8VZKJw32U4Ag5g6Nxbyh6", "decimals": 6},
    {"symbol": "BONK", "address": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "decimals": 5},
    {"symbol": "WIF", "address": "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLNYxdBY6Trd", "decimals": 6},
    {"symbol": "RAY", "address": "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", "decimals": 6},
    {"symbol": "RENDER", "address": "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof", "decimals": 8},
    {"symbol": "POPCAT", "address": "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", "decimals": 9},
    {"symbol": "MEW", "address": "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREqczveZ5c", "decimals": 6},
    {"symbol": "PYTH", "address": "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", "decimals": 6},
    {"symbol": "JTO", "address": "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", "decimals": 9},
    {"symbol": "WEN", "address": "WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk", "decimals": 5},
    {"symbol": "BOME", "address": "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82", "decimals": 6},
    {"symbol": "SLERF", "address": "7BgBvyjr2HDURj8w04EpJmVgtqWkMmq5vq5GqgJsS3o", "decimals": 9},
    {"symbol": "SAMO", "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA6wbSHx9LXc6L", "decimals": 9},
    {"symbol": "DUST", "address": "DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ", "decimals": 9},
    {"symbol": "NOS", "address": "nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7", "decimals": 6}
]

# Token Map (Solana) - Populated dynamically
TOKENS = { t['symbol']: t['address'] for t in FALLBACK_TOKENS }
TOKEN_METADATA = { t['address']: {'symbol': t['symbol'], 'decimals': t['decimals']} for t in FALLBACK_TOKENS }

JUP_KEY_HEADER = {}

def fetch_token_list(api_key=None):
    headers = {"x-api-key": api_key} if api_key else {}
    if not api_key:
         print("Warning: No Jupiter API Key provided. Token list/Price/Swap might fail (401).")
         # We already populated TOKENS with FALLBACK_TOKENS, so just return
         return

    tokens_to_load = []
    try:
        resp = requests.get(JUPITER_TOKEN_API, headers=headers, timeout=5)
        if resp.status_code == 200:
            tokens_to_load = resp.json()
            # print("Successfully loaded online token list.")
        else:
            print(f"Warning: Failed to fetch token list (HTTPS {resp.status_code}). Using offline fallback list.")
            return

    except Exception as e:
        print(f"Warning: Failed to fetch token list ({e}). Using robust offline fallback list.")
        return

    for t in tokens_to_load:
        symbol = t.get('symbol')
        address = t.get('address')
        decimals = t.get('decimals', 6)
        
        if symbol and address:
            if symbol not in TOKENS:
                TOKENS[symbol] = address
            
            TOKEN_METADATA[address] = {
                "symbol": symbol,
                "decimals": decimals
            }
                
            if symbol == "SOL":
                    TOKEN_METADATA[address] = {"symbol": "SOL", "decimals": 9}

def get_keypair(private_key_b58: str) -> Keypair:
    try:
        if private_key_b58.startswith("0x") or len(private_key_b58) == 64:
             return Keypair.from_seed(bytes.fromhex(private_key_b58.replace("0x", "")))
        return Keypair.from_base58_string(private_key_b58)
    except Exception as e:
        try:
             return Keypair.from_seed(bytes.fromhex(private_key_b58))
        except:
             print(f"Error loading keypair: {e}")
             sys.exit(1)

def get_client(rpc_url: str) -> Client:
    return Client(rpc_url)

def resolve_token_address(token_symbol_or_address: str) -> str:
    upper = token_symbol_or_address.upper()
    if upper in TOKENS:
        return TOKENS[upper]
    try:
        Pubkey.from_string(token_symbol_or_address)
        return token_symbol_or_address
    except:
        pass
    return token_symbol_or_address

def get_token_decimals(mint_address: str) -> int:
    if mint_address in TOKEN_METADATA:
        return TOKEN_METADATA[mint_address]['decimals']
    if mint_address == TOKENS["SOL"]: return 9
    if mint_address == TOKENS["USDC"]: return 6
    if mint_address == TOKENS["USDT"]: return 6
    return 6

def action_balance(args, client: Client, keypair: Keypair):
    pubkey = keypair.pubkey()
    print(f"Wallet Address: {pubkey}")
    
    try:
        resp = client.get_balance(pubkey)
        lamports = resp.value
        sol_balance = lamports / 1_000_000_000
        print(f"SOL Balance: {sol_balance:.4f} SOL")
    except Exception as e:
        print(f"Error fetching SOL balance: {e}")

    if args.token:
        # Simplified: Use resolve logic but without complex SPL query yet
        pass
        
    # List all non-zero accounts logic omitted for brevity in this task, focused on Swap/Portfolio

def action_transfer(args, client: Client, keypair: Keypair):
    if not args.to or not args.amount:
        print("Error: --to and --amount required for transfer")
        sys.exit(1)
    
    try:
        dest_pubkey = Pubkey.from_string(args.to)
        lamports = int(float(args.amount) * 1_000_000_000)
        
        print(f"Transferring {args.amount} SOL to {args.to}...")
        
        ix = transfer(
            TransferParams(
                from_pubkey=keypair.pubkey(),
                to_pubkey=dest_pubkey,
                lamports=lamports
            )
        )
        tx = Transaction().add(ix)
        result = client.send_transaction(tx, keypair)
        print(f"Transfer Sent: {result.value}")
        
    except Exception as e:
        print(f"Transfer Error: {e}")

def action_portfolio(args, client: Client, keypair: Keypair):
    print(f"Scanning Portfolio for {keypair.pubkey()}...")
    
    sol_bal = 0
    try:
        sol_bal = client.get_balance(keypair.pubkey()).value / 1_000_000_000
    except: pass
    
    holdings = {"SOL": sol_bal}
    
    try:
        opts = TokenAccountOpts(program_id=Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), encoding="jsonParsed")
        resp = client.get_token_accounts_by_owner(keypair.pubkey(), opts)
        
        for tx in resp.value:
            data = tx.account.data.parsed['info']
            mint = data['mint']
            amount = data['tokenAmount']['uiAmount']
            if amount and amount > 0:
                sym = mint
                if mint in TOKEN_METADATA:
                    sym = TOKEN_METADATA[mint]['symbol']
                else:
                    for k,v in TOKENS.items():
                        if v == mint: sym = k
                holdings[sym] = amount
    except Exception as e:
        print(f"Token Scan Error: {e}")
        
    ids = []
    for sym in holdings.keys():
        if sym == "SOL": ids.append(TOKENS["SOL"])
        elif sym in TOKENS: ids.append(TOKENS[sym])
        else: ids.append(sym)
        
    price_url = f"{JUPITER_PRICE_API}?ids={','.join(ids)}"
    prices = {}
    try:
        r = requests.get(price_url, headers=JUP_KEY_HEADER).json()
        if 'data' in r:
            prices = r['data']
        elif 'code' in r and r['code'] == 401:
            print("Warning: Unauthorized (401) fetching prices. Check Jupiter API Key.")
    except: pass
    
    total_usd = 0
    print("Holdings:")
    for sym, amt in holdings.items():
        mint = TOKENS.get(sym, sym)
        price_data = prices.get(mint)
        usd = 0
        p_str = "N/A"
        if price_data:
            p = float(price_data['price'])
            usd = amt * p
            p_str = f"${p:.4f}"
        else:
            # Simple fallback for stablecoins if price fails
            if sym in ["USDC", "USDT"]:
                usd = amt
                p_str = "$1.0000 (est)"
            
        total_usd += usd
        print(f"- {amt:.4f} {sym} (@ {p_str}) = ${usd:.2f}")
        
    print(f"Total Portfolio Value: ${total_usd:.2f}")

def monitor_arbitrage(args, client: Client, keypair: Keypair):
    token_a = TOKENS["SOL"]
    token_b = TOKENS["USDC"]
    interval = args.interval or 60
    print(f"🚀 Starting Jupiter Monitor (SOL/USDC) - Interval {interval}s")
    
    while True:
        try:
            price_url = f"{JUPITER_PRICE_API}?ids={token_a}"
            p_resp = requests.get(price_url, headers=JUP_KEY_HEADER).json()
            if 'data' not in p_resp:
                print("Error fetching price (Auth?)")
                if args.once: break
                time.sleep(5)
                continue

            jw_price = float(p_resp['data'][token_a]['price'])
            print(f"[{time.strftime('%H:%M:%S')}] SOL Price: ${jw_price:.2f}")
            
            if args.once: break
            time.sleep(interval)
        except KeyboardInterrupt: break
        except Exception as e:
            print(f"Monitor Err: {e}")
            if args.once: break
            time.sleep(5)

def action_swap(args, client: Client, keypair: Keypair):
    if not args.token_in or not args.token_out or not args.amount:
        print("Error: --token-in, --token-out, and --amount are required for swap")
        sys.exit(1)
        
    token_in = resolve_token_address(args.token_in)
    token_out = resolve_token_address(args.token_out)
    
    decimals = get_token_decimals(token_in)
    amount_in_atoms = int(float(args.amount) * (10**decimals))
    
    # New Jupiter V6 Quote Endpoint (GET style params appended generally work, or use POST if docs strictly say so. User snippet used GET structure for v1 quote)
    # User said: "https://api.jup.ag/swap/v1/quote?inputMint=..."
    quote_url = f"{JUPITER_QUOTE_API}?inputMint={token_in}&outputMint={token_out}&amount={amount_in_atoms}&slippageBps={int(args.slippage * 100)}"
    
    try:
        quote_resp = requests.get(quote_url, headers=JUP_KEY_HEADER).json()
        if "errorCode" in quote_resp or "error" in quote_resp:
             err = quote_resp.get('error', quote_resp.get('errorCode'))
             print(f"Quote Error: {err}")
             return
            
        print(f"Quote received: In={quote_resp['inAmount']} Out={quote_resp['outAmount']}")
        
        if args.quote_only:
            return

        payload = {
            "userPublicKey": str(keypair.pubkey()),
            "quoteResponse": quote_resp,
            "prioritizationFeeLamports": int(args.priority_fee) if args.priority_fee and args.priority_fee != "auto" else "auto"
        }
        
        if args.priority_fee and args.priority_fee != "auto":
             print(f"Using Custom Priority Fee: {args.priority_fee} lamports")

        swap_resp = requests.post(JUPITER_SWAP_API, json=payload, headers=JUP_KEY_HEADER).json()
        if "error" in swap_resp:
            print(f"Swap Error: {swap_resp['error']}")
            return
            
        swap_transaction = swap_resp['swapTransaction']
        raw_tx = base64.b64decode(swap_transaction)
        tx = VersionedTransaction.from_bytes(raw_tx)
        
        signature = keypair.sign_message(to_bytes_versioned(tx.message))
        signed_tx = VersionedTransaction.populate(tx.message, [signature])
        
        print("Sending transaction...")
        result = client.send_transaction(signed_tx)
        print(f"Swap executed! Signature: {result.value}")
        
    except Exception as e:
        print(f"Swap failed: {e}")

def main():
    parser = argparse.ArgumentParser(description="Solana Wallet Manager")
    parser.add_argument("--action", choices=["balance", "transfer", "swap", "quote", "portfolio", "monitor"], required=True)
    parser.add_argument("--rpc", default="https://api.mainnet-beta.solana.com", help="RPC URL")
    parser.add_argument("--private-key", help="Base58 Private Key")
    parser.add_argument("--jup-key", help="Jupiter API Key (x-api-key)")
    parser.add_argument("--token", help="Token symbol or address (for balance)")
    parser.add_argument("--token-in", help="Token to sell")
    parser.add_argument("--token-out", help="Token to buy")
    parser.add_argument("--amount", help="Amount to swap/transfer")
    parser.add_argument("--to", help="Recipient address")
    parser.add_argument("--slippage", type=float, default=0.5, help="Slippage % (default 0.5)")
    parser.add_argument("--priority-fee", default="auto", help="Priority fee in lamports or 'auto'")
    parser.add_argument("--quote-only", action="store_true", help="Only show quote, do not execute")
    parser.add_argument("--interval", type=int, help="Monitor interval")
    parser.add_argument("--once", action="store_true", help="Monitor run once")
    
    args = parser.parse_args()
    
    # Load Config
    import os
    config_path = os.path.expanduser("~/.verso/verso.json")
    
    loaded_rpc = None
    loaded_key = None
    loaded_jup_key = None
    
    if os.path.exists(config_path):
        try:
            with open(config_path) as f:
                data = json.load(f)
                crypto = data.get('crypto', {})
                if crypto.get('enabled'):
                    loaded_key = crypto.get('solanaPrivateKey')
                    loaded_jup_key = crypto.get('jupiterApiKey')
                    
                    if crypto.get('solanaRpcUrl'):
                        loaded_rpc = crypto.get('solanaRpcUrl')
                    elif crypto.get('alchemyApiKey'):
                        loaded_rpc = f"https://solana-mainnet.g.alchemy.com/v2/{crypto.get('alchemyApiKey')}"
        except Exception: pass

    # Apply Config
    if not args.private_key and loaded_key: args.private_key = loaded_key
    if not args.jup_key and loaded_jup_key: args.jup_key = loaded_jup_key
    if args.rpc == "https://api.mainnet-beta.solana.com" and loaded_rpc: args.rpc = loaded_rpc

    if not args.private_key:
        print("Error: --private-key is required")
        sys.exit(1)
        
    # Set Global Header
    global JUP_KEY_HEADER
    if args.jup_key:
        JUP_KEY_HEADER = {"x-api-key": args.jup_key}
    
    # Initialize Lists
    fetch_token_list(args.jup_key)

    keypair = get_keypair(args.private_key)
    client = get_client(args.rpc)
    
    try:
        if args.action == "balance":
            action_balance(args, client, keypair)
        elif args.action == "transfer":
            action_transfer(args, client, keypair)
        elif args.action == "portfolio":
            action_portfolio(args, client, keypair)
        elif args.action == "monitor":
            monitor_arbitrage(args, client, keypair)
        elif args.action == "swap" or args.action == "quote":
            if args.action == "quote": args.quote_only = True
            action_swap(args, client, keypair)
        else:
            print(f"Action {args.action} not fully implemented yet.")
    except KeyboardInterrupt:
        print("\nOperation cancelled.")
    except Exception as e:
        print(f"Unexpected error: {e}")

if __name__ == "__main__":
    main()
