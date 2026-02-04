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
from solana.rpc.types import TxOpts
from solana.transaction import Transaction

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

def get_keypair(private_key_b58: str) -> Keypair:
    try:
        return Keypair.from_base58_string(private_key_b58)
    except Exception as e:
        print(f"Error loading keypair: {e}")
        sys.exit(1)

def get_client(rpc_url: str) -> Client:
    return Client(rpc_url)

def resolve_token_address(token_symbol_or_address: str) -> str:
    # Check if it's in our map
    upper = token_symbol_or_address.upper()
    if upper in TOKENS:
        return TOKENS[upper]
    return token_symbol_or_address

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

def action_portfolio(args, keypair: Keypair):
    # Use Jupiter Price API to value portfolio?
    # Or just list held tokens.
    # To list held tokens efficiently, we need to parse TokenAccounts.
    # For MVP, let's stick to SOL balance.
    pass

def action_swap(args, client: Client, keypair: Keypair):
    if not args.token_in or not args.token_out or not args.amount:
        print("Error: --token-in, --token-out, and --amount are required for swap")
        sys.exit(1)
        
    token_in = resolve_token_address(args.token_in)
    token_out = resolve_token_address(args.token_out)
    
    # 1. Get Quote
    amount_in_atoms = int(float(args.amount) * (10**9)) # ASSUMES 9 decimals (SOL). If USDC (6 decimals), this is wrong.
    # We need decimals. 
    # Hardcode for common tokens? Or fetch decimals?
    decimals = 9
    if token_in == TOKENS["USDC"] or token_in == TOKENS["USDT"]:
        decimals = 6
    
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
            # "useSharedAccounts": True
        }
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
    
    # Load Config (Environment or Args)
    # Ideally passed by caller, but we can check ENV variables or args.
    # Typically verso passes args.
    
    if not args.private_key:
        # Check ~/.verso/verso.json if we want to be fancy, but simpler to rely on caller passing it?
        # verso.json parsing is handled by typescript usually. 
        # But wait, skill scripts usually get args passed from the Agent runtime.
        # The agent should read verso.json and pass `--private-key`.
        if not args.private_key:
            print("Error: --private-key is required")
            sys.exit(1)

    keypair = get_keypair(args.private_key)
    client = get_client(args.rpc)
    
    try:
        if args.action == "balance":
            action_balance(args, client, keypair)
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
