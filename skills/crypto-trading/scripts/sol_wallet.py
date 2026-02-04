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
from solana.rpc.api import Client
from solana.rpc.types import TokenAccountOpts

# Constants
JUPITER_QUOTE_API = "https://quote-api.jup.ag/v6/quote"
JUPITER_SWAP_API = "https://quote-api.jup.ag/v6/swap"
JUPITER_PRICE_API = "https://api.jup.ag/price/v2"

# Token Map (Solana) - Can be extended
TOKENS = {
    "SOL": "So11111111111111111111111111111111111111112",
    "USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "USDT": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    "BONK": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "WIF": "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLNYxdBY6Trd",
}

def get_keypair(private_key_str: str) -> Keypair:
    try:
        # Try Base58
        return Keypair.from_base58_string(private_key_str)
    except:
        try:
            # Try Hex Seed (32 bytes)
            seed = bytes.fromhex(private_key_str)
            return Keypair.from_seed(seed)
        except Exception as e:
            print(f"Error loading keypair: {e}")
            sys.exit(1)

def get_client(rpc_url: str) -> Client:
    return Client(rpc_url)

def resolve_token_address(token_symbol_or_address: str) -> str:
    upper = token_symbol_or_address.upper()
    if upper in TOKENS:
        return TOKENS[upper]
    return token_symbol_or_address

def action_portfolio(client: Client, keypair: Keypair):
    pubkey = keypair.pubkey()
    print(f"Scanning Portfolio for {pubkey}...")
    
    # 1. SOL Balance
    sol_bal = 0
    try:
        sol_bal = client.get_balance(pubkey).value / 1_000_000_000
    except: pass
    
    holdings = {"SOL": sol_bal}
    
    # 2. Token Accounts (Parsed)
    try:
        opts = TokenAccountOpts(program_id=Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), encoding="jsonParsed")
        resp = client.get_token_accounts_by_owner(pubkey, opts)
        
        for tx in resp.value:
            data = tx.account.data.parsed['info']
            mint = data['mint']
            amount = data['tokenAmount']['uiAmount']
            if amount and amount > 0:
                sym = mint
                for k,v in TOKENS.items():
                    if v == mint: sym = k
                holdings[sym] = amount
    except Exception as e:
        print(f"Token Scan Error: {e}")
        
    # 3. Price Feed
    ids = []
    for sym in holdings.keys():
        ids.append(TOKENS.get(sym, sym))
        
    prices = {}
    if ids:
        try:
            r = requests.get(f"{JUPITER_PRICE_API}?ids={','.join(ids)}").json()
            if 'data' in r:
                prices = r['data']
        except: pass
    
    total_usd = 0
    print("\nHoldings:")
    for sym, amt in holdings.items():
        mint = TOKENS.get(sym, sym)
        price_data = prices.get(mint)
        usd = 0
        p_str = "N/A"
        if price_data:
            p = float(price_data['price'])
            usd = amt * p
            p_str = f"${p:.4f}"
            
        total_usd += usd
        print(f"- {amt:.4f} {sym} (@ {p_str}) = ${usd:.2f}")
        
    print(f"\nTotal Portfolio Value: ${total_usd:.2f}")

def main():
    parser = argparse.ArgumentParser(description="Solana Wallet Manager")
    parser.add_argument("--action", choices=["balance", "transfer", "swap", "quote", "portfolio"], required=True)
    parser.add_argument("--rpc", default="https://api.mainnet-beta.solana.com", help="RPC URL")
    parser.add_argument("--private-key", help="Private Key (Base58 or Hex)")
    parser.add_argument("--token", help="Token symbol or address")
    parser.add_argument("--amount", help="Amount")
    parser.add_argument("--to", help="Recipient")
    
    args = parser.parse_args()
    
    import os
    config_path = os.path.expanduser("~/.verso/verso.json")
    loaded_key = None
    loaded_rpc = None
    
    if os.path.exists(config_path):
        with open(config_path) as f:
            data = json.load(f)
            crypto = data.get('crypto', {})
            loaded_key = crypto.get('solanaPrivateKey')
            loaded_rpc = crypto.get('solanaRpcUrl')

    if not args.private_key: args.private_key = loaded_key
    if args.rpc == "https://api.mainnet-beta.solana.com" and loaded_rpc: args.rpc = loaded_rpc

    if not args.private_key:
        print("Error: Private key missing")
        sys.exit(1)

    keypair = get_keypair(args.private_key)
    client = get_client(args.rpc)
    
    if args.action == "portfolio":
        action_portfolio(client, keypair)
    elif args.action == "balance":
        # Simplified balance for now
        action_portfolio(client, keypair)
    else:
        print(f"Action {args.action} not fully implemented in this version.")

if __name__ == "__main__":
    main()
