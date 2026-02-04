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

# Constants
JUPITER_QUOTE_API = "https://quote-api.jup.ag/v6/quote"
JUPITER_SWAP_API = "https://quote-api.jup.ag/v6/swap"
JUPITER_PRICE_API = "https://api.jup.ag/price/v2"

# Token Map (Solana) - Populated dynamically
TOKENS = {
    "SOL": "So11111111111111111111111111111111111111112",
    "USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "USDT": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    "BONK": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "WIF": "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLNYxdBY6Trd",
}
TOKEN_METADATA = {} # Mint -> {symbol, decimals}

def fetch_token_list():
    try:
        # print("Fetching Jupiter Token List...")
        # Strict list (verified tokens only)
        url = "https://token.jup.ag/strict"
        resp = requests.get(url, timeout=5)
        tokens = resp.json()
        
        for t in tokens:
            symbol = t.get('symbol')
            address = t.get('address')
            decimals = t.get('decimals', 6)
            
            if symbol and address:
                # Update Maps
                # Prefer existing keys if duplicate symbols exist (usually not an issue in strict list)
                if symbol not in TOKENS:
                    TOKENS[symbol] = address
                
                TOKEN_METADATA[address] = {
                    "symbol": symbol,
                    "decimals": decimals
                }
                
                # Ensure hardcoded mints also have metadata
                if symbol == "SOL":
                     TOKEN_METADATA[address] = {"symbol": "SOL", "decimals": 9}

    except Exception as e:
        print(f"Warning: Failed to fetch token list ({e}). Using offline defaults.")

# Initialize immediately? Or lazily? 
# For CLI script, immediate is fine but might slow down simple Ops.
# Let's call it in main if needed, or lazily.
# For now, let's just populate it at module level or top of main actions.

def get_keypair(private_key_b58: str) -> Keypair:
    try:
        if private_key_b58.startswith("0x") or len(private_key_b58) == 64:
             return Keypair.from_seed(bytes.fromhex(private_key_b58.replace("0x", "")))
        return Keypair.from_base58_string(private_key_b58)
    except Exception as e:
        # Fallback for old hex format without 0x or different encoding
        try:
             return Keypair.from_seed(bytes.fromhex(private_key_b58))
        except:
             print(f"Error loading keypair: {e}")
             sys.exit(1)

def get_client(rpc_url: str) -> Client:
    return Client(rpc_url)

def resolve_token_address(token_symbol_or_address: str) -> str:
    # Check if known symbol
    upper = token_symbol_or_address.upper()
    if upper in TOKENS:
        return TOKENS[upper]
        
    # Check if valid Pubkey (mint address)
    try:
        Pubkey.from_string(token_symbol_or_address)
        return token_symbol_or_address
    except:
        pass
        
    return token_symbol_or_address

def get_token_decimals(mint_address: str) -> int:
    if mint_address in TOKEN_METADATA:
        return TOKEN_METADATA[mint_address]['decimals']
    # Defaults
    if mint_address == TOKENS["SOL"]: return 9
    if mint_address == TOKENS["USDC"]: return 6
    if mint_address == TOKENS["USDT"]: return 6
    return 6 # Fallback

def action_balance(args, client: Client, keypair: Keypair):
    pubkey = keypair.pubkey()
    print(f"Wallet Address: {pubkey}")
    
    # SOL Balance
    try:
        resp = client.get_balance(pubkey)
        lamports = resp.value
        sol_balance = lamports / 1_000_000_000
        print(f"SOL Balance: {sol_balance:.4f} SOL")
    except Exception as e:
        print(f"Error fetching SOL balance: {e}")

    # SPL Token Balance (if requested or all?)
    # For now, let's fetch specific token if requested, or just SOL.
    if args.token:
        mint = Pubkey.from_string(resolve_token_address(args.token))
        try:
            # get_token_accounts_by_owner is a bit heavy, prefer get_token_account_balance if we know the account?
            # actually we need to find the ATA (Associated Token Account)
            # Simpler: fetch all token accounts and filter?
            # Or use get_token_accounts_by_owner
            from spl.token.instructions import get_associated_token_address
            
            # This requires 'spl-token' lib but solders might not have it built-in directly? 
            # We used 'pip install solana'. Solana.py has spl integration.
            # But let's use the RPC method 'getTokenAccountsByOwner'
            from solders.rpc.responses import GetTokenAccountsByOwnerResp
            
            # Using RPC directly is easier
            opts =  {"mint": mint}
            # client.get_token_accounts_by_owner(pubkey, opts)
            # Actually solana.py client wraps this.
            
            # Alternative: Jupiter Price API can verify holding if we integrated portfolio logic.
            # But for raw balance:
            # Check parsed token accounts
            # Helper to find ATA using rpc?
            # Let's list all accounts and filter.
            pass
        except:
            pass
        
    # List all non-zero accounts
    try:
        from solana.rpc.types import TokenAccountOpts
        opts = TokenAccountOpts(program_id=Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))
        resp = client.get_token_accounts_by_owner(pubkey, opts)
        # We need to parse the data. 
        # This is getting complex without 'spl-token' helper.
        # Let's trust user inputs or use a simpler approach if possible.
        # Actually, let's keep it simple: SOL only for now unless requested.
        pass
    except Exception as e:
        print(f"Error fetching token accounts: {e}")

def action_transfer(args, client: Client, keypair: Keypair):
    if not args.to or not args.amount:
        print("Error: --to and --amount required for transfer")
        sys.exit(1)
    
    try:
        dest_pubkey = Pubkey.from_string(args.to)
        lamports = int(float(args.amount) * 1_000_000_000)
        
        print(f"Transferring {args.amount} SOL to {args.to}...")
        
        # System Program Transfer
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
    
    # 1. SOL Balance
    sol_bal = 0
    try:
        sol_bal = client.get_balance(keypair.pubkey()).value / 1_000_000_000
    except: pass
    
    holdings = {"SOL": sol_bal}
    
    # 2. Token Accounts (Parsed)
    try:
        # standard Token Program
        opts = TokenAccountOpts(program_id=Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), encoding="jsonParsed")
        resp = client.get_token_accounts_by_owner(keypair.pubkey(), opts)
        
        for tx in resp.value:
            data = tx.account.data.parsed['info']
            mint = data['mint']
            amount = data['tokenAmount']['uiAmount']
            if amount and amount > 0:

                # Resolve Symbol
                sym = mint
                if mint in TOKEN_METADATA:
                    sym = TOKEN_METADATA[mint]['symbol']
                else:
                    # Fallback to known tokens if any
                    for k,v in TOKENS.items():
                        if v == mint: sym = k
                
                holdings[sym] = amount
    except Exception as e:
        print(f"Token Scan Error: {e}")
        
    # 3. Price Feed (Jupiter)
    # Map symbols back to mints for price query
    ids = []
    for sym in holdings.keys():
        if sym == "SOL": ids.append(TOKENS["SOL"])
        elif sym in TOKENS: ids.append(TOKENS[sym])
        else: ids.append(sym) # Mint address
        
    price_url = f"{JUPITER_PRICE_API}?ids={','.join(ids)}"
    prices = {}
    try:
        r = requests.get(price_url).json()
        if 'data' in r:
            prices = r['data']
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
            
        total_usd += usd
        print(f"- {amt:.4f} {sym} (@ {p_str}) = ${usd:.2f}")
        
    print(f"Total Portfolio Value: ${total_usd:.2f}")

def monitor_arbitrage(args, client: Client, keypair: Keypair):
    # Monitor SOL vs USDC prices via Jupiter
    token_a = TOKENS["SOL"]
    token_b = TOKENS["USDC"]
    
    interval = args.interval or 60
    print(f"🚀 Starting Jupiter Monitor (SOL/USDC) - Interval {interval}s")
    
    while True:
        try:
            # 1. Get Price
            price_url = f"{JUPITER_PRICE_API}?ids={token_a}"
            p_resp = requests.get(price_url).json()
            jw_price = float(p_resp['data'][token_a]['price'])
            
            # 2. Get Quote (Buy 1 SOL)
            amt = 1 * 10**9
            q_url = f"{JUPITER_QUOTE_API}?inputMint={token_b}&outputMint={token_a}&amount={int(jw_price * 10**6)}&slippageBps=50"
            # Note: We are checking if buying 1 SOL with USDC is cheaper/expensive
            # Simplified Monitor: Just Print Price
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
    
    # 1. Get Quote
    # Determine decimals
    decimals = get_token_decimals(token_in)
    
    amount_in_atoms = int(float(args.amount) * (10**decimals))
    
    quote_url = f"{JUPITER_QUOTE_API}?inputMint={token_in}&outputMint={token_out}&amount={amount_in_atoms}&slippageBps={int(args.slippage * 100)}"
    
    try:
        quote_resp = requests.get(quote_url).json()
        if "error" in quote_resp:
            print(f"Quote Error: {quote_resp['error']}")
            return
            
        print(f"Quote received: In={quote_resp['inAmount']} Out={quote_resp['outAmount']}")
        
        if args.quote_only:
            return

        # 2. Get Swap Transaction
        payload = {
            "userPublicKey": str(keypair.pubkey()),
            "quoteResponse": quote_resp,
            # "useSharedAccounts": True,
            "prioritizationFeeLamports": int(args.priority_fee) if args.priority_fee and args.priority_fee != "auto" else "auto"
        }
        
        # If priority fee is explicit, use it. Default is "auto" which Jupiter handles smartly now.
        if args.priority_fee and args.priority_fee != "auto":
             print(f"Using Custom Priority Fee: {args.priority_fee} lamports")

        swap_resp = requests.post(JUPITER_SWAP_API, json=payload).json()
        if "error" in swap_resp:
            print(f"Swap Error: {swap_resp['error']}")
            return
            
        # 3. Sign and Send
        swap_transaction = swap_resp['swapTransaction']
        raw_tx = base64.b64decode(swap_transaction)
        tx = VersionedTransaction.from_bytes(raw_tx)
        
        # Sign
        signature = keypair.sign_message(to_bytes_versioned(tx.message))
        signed_tx = VersionedTransaction.populate(tx.message, [signature])
        
        # Send
        print("Sending transaction...")
        result = client.send_transaction(signed_tx)
        print(f"Swap executed! Signature: {result.value}")
        
    except Exception as e:
        print(f"Swap failed: {e}")

def main():
    parser = argparse.ArgumentParser(description="Solana Wallet Manager")
    parser.add_argument("--action", choices=["balance", "transfer", "swap", "quote", "portfolio"], required=True)
    parser.add_argument("--rpc", default="https://api.mainnet-beta.solana.com", help="RPC URL")
    parser.add_argument("--private-key", help="Base58 Private Key")
    parser.add_argument("--token", help="Token symbol or address (for balance)")
    parser.add_argument("--token-in", help="Token to sell")
    parser.add_argument("--token-out", help="Token to buy")
    parser.add_argument("--amount", help="Amount to swap/transfer")
    parser.add_argument("--to", help="Recipient address")
    parser.add_argument("--slippage", type=float, default=0.5, help="Slippage % (default 0.5)")
    parser.add_argument("--quote-only", action="store_true", help="Only show quote, do not execute")
    
    args = parser.parse_args()
    
    # Initialize Token List
    fetch_token_list()
    
    # Load Config from ~/.verso/verso.json if args missing
    import os
    config_path = os.path.expanduser("~/.verso/verso.json")
    
    loaded_rpc = None
    loaded_key = None
    
    if os.path.exists(config_path):
        try:
            with open(config_path) as f:
                data = json.load(f)
                crypto = data.get('crypto', {})
                if crypto.get('enabled'):
                    loaded_key = crypto.get('solanaPrivateKey')
                    
                    # Resolve RPC
                    if crypto.get('solanaRpcUrl'):
                        loaded_rpc = crypto.get('solanaRpcUrl')
                    elif crypto.get('alchemyApiKey'):
                        loaded_rpc = f"https://solana-mainnet.g.alchemy.com/v2/{crypto.get('alchemyApiKey')}"
        except Exception as e:
            # Silently fail config load, rely on args
            pass

    # Fallback to loaded config if args are missing
    if not args.private_key and loaded_key:
        args.private_key = loaded_key
        
    if args.rpc == "https://api.mainnet-beta.solana.com" and loaded_rpc:
        # Override default if we found a better one (e.g. Alchemy) in config
        args.rpc = loaded_rpc

    if not args.private_key:
        print("Error: --private-key is required (or configure via 'verso configure')")
        sys.exit(1)

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
            if args.action == "quote":
                args.quote_only = True
            action_swap(args, client, keypair)
        else:
            print(f"Action {args.action} not fully implemented yet.")
    except KeyboardInterrupt:
        print("\nOperation cancelled.")
    except Exception as e:
        print(f"Unexpected error: {e}")

if __name__ == "__main__":
    main()
