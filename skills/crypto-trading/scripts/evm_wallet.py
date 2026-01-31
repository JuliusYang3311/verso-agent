import sys
import os
import argparse
import json
import requests
import time
from decimal import Decimal

# Check for Web3 (for signing/transfers)
try:
    from web3 import Web3
    from web3.middleware import geth_poa_middleware
except ImportError:
    print("Error: 'web3' library is not installed. Please install it with 'pip install web3' to use wallet features.")
    sys.exit(1)

# --- Configuration & Constants ---

# Integrated Chain Configuration
# Using Etherscan V2 Unified API for all supported chains
# Docs: https://docs.etherscan.io/getting-started/endpoint-urls
UNIFIED_API_URL = "https://api.etherscan.io/v2/api"

CHAIN_CONFIG = {
    137: {
        'name': 'Polygon',
        'symbol': 'MATIC',
        'router': "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        'quoter': "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        'rpc_fallbacks': [
            'https://polygon-rpc.com', 'https://rpc-mainnet.maticvigil.com',
            'https://1rpc.io/matic', 'https://polygon.drpc.org'
        ]
    },
    1: {
        'name': 'Ethereum',
        'symbol': 'ETH',
        'router': "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        'quoter': "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        'rpc_fallbacks': ['https://cloudflare-eth.com', 'https://eth.llamarpc.com']
    },
    10: {
        'name': 'Optimism',
        'symbol': 'ETH',
        'router': "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        'quoter': "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        'rpc_fallbacks': ['https://mainnet.optimism.io', 'https://optimism.drpc.org']
    },
    42161: {
        'name': 'Arbitrum One',
        'symbol': 'ETH',
        'router': "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        'quoter': "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        'rpc_fallbacks': ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.drpc.org']
    }
}

# Default minimal fallback
DEFAULT_CONFIG = {'name': 'Unknown', 'symbol': 'ETH', 'router': None, 'quoter': None}

def get_chain_config(chain_id):
    return CHAIN_CONFIG.get(chain_id, DEFAULT_CONFIG)

# --- Helpers ---

def get_web3_with_fallback(primary_url):
    candidates = [primary_url]
    
    # Simple heuristics for auto-fallback
    if 'polygon' in primary_url or 'matic' in primary_url:
        candidates.extend(CHAIN_CONFIG[137]['rpc_fallbacks'])
    elif 'eth' in primary_url and 'arbitrum' not in primary_url and 'optimism' not in primary_url:
        candidates.extend(CHAIN_CONFIG[1]['rpc_fallbacks'])
        
    for url in candidates:
        if not url: continue
        try:
            w3 = Web3(Web3.HTTPProvider(url, request_kwargs={'timeout': 5}))
            w3.middleware_onion.inject(geth_poa_middleware, layer=0)
            if w3.is_connected():
                return w3
        except: continue
    
    print("Error: Could not connect to RPC.")
    sys.exit(1)

def calc_gas_fees(w3):
    # ... (same as before) ...
    try:
        latest = w3.eth.get_block("latest")
        base_fee = latest['baseFeePerGas']
        priority_fee = w3.to_wei(30, 'gwei')
        max_fee = (2 * base_fee) + priority_fee
        return {'maxFeePerGas': max_fee, 'maxPriorityFeePerGas': priority_fee}
    except:
        return {'gasPrice': w3.eth.gas_price}

def fetch_token_prices(chain_id, contract_addresses):
    if not contract_addresses: return {}
    platforms = { 137: 'polygon-pos', 1: 'ethereum', 10: 'optimism-ethereum', 42161: 'arbitrum-one' }
    platform = platforms.get(chain_id)
    if not platform: return {}
    
    results = {}
    total = len(contract_addresses)
    if total > 0:
        print(f"Fetching prices for {total} tokens (1.5s delay for API limits)...")
    
    for i, addr in enumerate(contract_addresses):
        url = f"https://api.coingecko.com/api/v3/simple/token_price/{platform}?contract_addresses={addr}&vs_currencies=usd"
        try:
            resp = requests.get(url, timeout=10).json()
            for k, v in resp.items():
                if isinstance(v, dict):
                    results[k.lower()] = v.get('usd', 0)
            
            # Rate limit pacing (Free Tier allows ~10-30 req/min depending on load)
            if i < total - 1:
                time.sleep(1.5) 
        except Exception as e:
            # Silent fail for individual tokens to keep others processing
            pass
            
    return results

def fetch_portfolio_from_api(address, chain_id, api_key=None):
    # Etherscan V2 Unified Usage
    base_url = UNIFIED_API_URL
    
    # 1. Native Balance
    native_bal = 0
    try:
        url = f"{base_url}?chainid={chain_id}&module=account&action=balance&address={address}&tag=latest"
        if api_key: url += f"&apikey={api_key}"
        resp = requests.get(url, timeout=5).json()
        if resp['status'] == '1':
            native_bal = Decimal(resp['result']) / Decimal(10**18)
    except: pass

    # 2. Token History
    candidates = set()
    try:
        url = f"{base_url}?chainid={chain_id}&module=account&action=tokentx&address={address}&page=1&offset=100&sort=desc"
        if api_key: url += f"&apikey={api_key}"
        resp = requests.get(url, timeout=5).json()
        if resp['status'] == '1':
            for tx in resp['result']:
                # Basic filter to avoid obvious garbage if needed, but checksum handles most
                candidates.add(tx['contractAddress'])
    except: pass

    return list(candidates), native_bal

def fetch_native_price(chain_id):
    # Try POL ID first, then legacy MATIC
    coins = ['polygon-ecosystem-token', 'matic-network'] if chain_id == 137 else ['ethereum']
    if chain_id == 10: coins = ['optimism']
    if chain_id == 42161: coins = ['arbitrum']
    
    for coin in coins:
        try:
            url = f"https://api.coingecko.com/api/v3/simple/price?ids={coin}&vs_currencies=usd"
            price = requests.get(url, timeout=5).json().get(coin, {}).get('usd', 0)
            if price > 0: return price
        except:
            pass
    return 0

# --- Main ---

def get_quote(w3, token_in, token_out, amount_in_wei, fee=3000):
    config = get_chain_config(w3.eth.chain_id)
    quoter_addr = config.get('quoter')
    
    if not quoter_addr:
        print(f"Quoter not configured for chain {w3.eth.chain_id}")
        return None

    try:
        # QuoterV2 ABI (Minimal for quoteExactInputSingle)
        abi = [{
            "inputs": [
                {
                    "components": [
                        {"internalType": "address", "name": "tokenIn", "type": "address"},
                        {"internalType": "address", "name": "tokenOut", "type": "address"},
                        {"internalType": "uint256", "name": "amountIn", "type": "uint256"},
                        {"internalType": "uint24", "name": "fee", "type": "uint24"},
                        {"internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160"}
                    ],
                    "internalType": "struct IQuoterV2.QuoteExactInputSingleParams",
                    "name": "params",
                    "type": "tuple"
                }
            ],
            "name": "quoteExactInputSingle",
            "outputs": [
                {"internalType": "uint256", "name": "amountOut", "type": "uint256"},
                {"internalType": "uint160", "name": "sqrtPriceX96After", "type": "uint160"},
                {"internalType": "uint32", "name": "initializedTicksCrossed", "type": "uint32"},
                {"internalType": "uint256", "name": "gasEstimate", "type": "uint256"}
            ],
            "stateMutability": "nonpayable",
            "type": "function"
        }]
        
        quoter = w3.eth.contract(address=quoter_addr, abi=abi)
        
        # Params: (tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96)
        params = (
            token_in,
            token_out,
            amount_in_wei,
            fee,
            0
        )
        
        # Quoter is view function but sometimes needs 'call' explicitly if not marked pure/view in old web3, 
        # but QuoterV2 is state changing in solidity but reverted. So we MUST use .call()
        result = quoter.functions.quoteExactInputSingle(params).call()
        amount_out = result[0]
        return amount_out
    except Exception as e:
        print(f"Quote Error: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description='Verso EVM Wallet')
    parser.add_argument('--action', required=True, choices=['balance', 'transfer', 'portfolio', 'explorer', 'approve', 'swap', 'quote', 'history'])
    parser.add_argument('--to', help='Recipient / Address')
    parser.add_argument('--amount', type=float)
    parser.add_argument('--token', help='Token Symbol/Address')
    parser.add_argument('--token-in', help='Swap Input Token Address')
    parser.add_argument('--token-out', help='Swap Output Token Address')
    parser.add_argument('--fee', type=int, default=3000, help='Pool Fee Tier (e.g. 500, 3000, 10000). Default 3000')
    parser.add_argument('--slippage', type=float, default=0.5, help='Slippage tolerance %% (default 0.5)')
    
    # Network Selection (replaces generic --rpc)
    parser.add_argument('--network', default='polygon', choices=['polygon', 'ethereum', 'optimism', 'arbitrum'], help='Network selection (default: polygon)')
    
    # Legacy args, kept for compatibility but de-prioritized
    parser.add_argument('--rpc', help='(Deprecated) Override RPC URL') 
    parser.add_argument('--api-key', help='Explorer API Key')
    args = parser.parse_args()

    # Load Config
    config_path = os.path.expanduser("~/.verso/verso.json")
    # Default to None, strict Alchemy requirement
    rpc_url = None 
    alchemy_api_key = os.getenv('ALCHEMY_API_KEY')
    private_key = os.getenv('WALLET_PRIVATE_KEY')
    explorer_api_key = os.getenv('EXPLORER_API_KEY')

    if os.path.exists(config_path):
        try:
            with open(config_path) as f:
                c = json.load(f).get('crypto', {})
                if c.get('enabled'):
                    alchemy_api_key = c.get('alchemyApiKey', alchemy_api_key)
                    private_key = c.get('privateKey', private_key)
                    explorer_api_key = c.get('explorerApiKey', explorer_api_key)
        except: pass

    if args.rpc: rpc_url = args.rpc
    if args.api_key: explorer_api_key = args.api_key

    if not alchemy_api_key and not args.rpc:
        print("Error: Alchemy API Key is required for Private RPC. Please run 'verso configure' or set ALCHEMY_API_KEY.")
        sys.exit(1)

    if args.rpc:
        rpc_url = args.rpc
    else:
        # Build Alchemy URL based on --network
        alchemy_map = {
            'polygon': "polygon-mainnet",
            'ethereum': "eth-mainnet",
            'optimism': "opt-mainnet",
            'arbitrum': "arb-mainnet"
        }
        network_key = alchemy_map.get(args.network, 'polygon-mainnet')
        rpc_url = f"https://{network_key}.g.alchemy.com/v2/{alchemy_api_key}"
        print(f"⚡ Connected to {args.network.title()} via Alchemy Private RPC")
        
    w3 = get_web3_with_fallback(rpc_url)
    
    chain_id = w3.eth.chain_id
    config = get_chain_config(chain_id)
    
    account = w3.eth.account.from_key(private_key) if private_key else None
    my_address = account.address if account else args.to

    # Actions
    if args.action == 'history':
        if not my_address: print("Need address"); sys.exit(1)
        
        # V2 Unified API
        base_url = UNIFIED_API_URL
        print(f"Fetching History for {my_address} on {config['name']} (Chain {chain_id})...")
        
        url = f"{base_url}?chainid={chain_id}&module=account&action=txlist&address={my_address}&startblock=0&endblock=99999999&page=1&offset=10&sort=desc"
        if explorer_api_key: url += f"&apikey={explorer_api_key}"
        
        try:
            resp = requests.get(url, timeout=10).json()
            if resp['status'] == '1':
                for tx in resp['result']:
                    ts = time.strftime('%Y-%m-%d %H:%M', time.localtime(int(tx['timeStamp'])))
                    val = Decimal(tx['value']) / Decimal(10**18)
                    direction = "OUT" if tx['from'].lower() == my_address.lower() else "IN "
                    to_addr = tx['to']
                    print(f"[{ts}] {direction} {val:.4f} {config['symbol']} -> {to_addr[:8]}... ({tx['hash'][:10]}...)")
            else:
                print("No transactions found or API error.")
        except Exception as e:
            print(f"Error: {e}")
        return

    if args.action == 'quote':
        if not args.token_in or not args.token_out or not args.amount:
             print("Error: --token-in, --token-out, --amount required for quote")
             sys.exit(1)
        
        t_in = w3.to_checksum_address(args.token_in)
        t_out = w3.to_checksum_address(args.token_out)
        
        # Get Decimals
        abi_dec = [{"constant":True,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"payable":False,"type":"function"},
                   {"constant":True,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"payable":False,"type":"function"}]
        
        c_in = w3.eth.contract(address=t_in, abi=abi_dec)
        c_out = w3.eth.contract(address=t_out, abi=abi_dec)
        
        try:
            dec_in = c_in.functions.decimals().call()
            sym_in = c_in.functions.symbol().call()
        except: 
            dec_in = 18
            sym_in = "IN"
            
        try:
            dec_out = c_out.functions.decimals().call()
            sym_out = c_out.functions.symbol().call()
        except:
            dec_out = 18
            sym_out = "OUT"
        
        amount_in_wei = int(args.amount * (10**dec_in))
        
        print(f"Quoting {args.amount} {sym_in} -> {sym_out} (Fee: {args.fee}) ...")
        out_wei = get_quote(w3, t_in, t_out, amount_in_wei, args.fee)
        
        if out_wei:
            val = Decimal(out_wei) / Decimal(10**dec_out)
            print(f"Estimated Output: {val:.6f} {sym_out}")
            return
        else:
            print("Quote failed.")
            sys.exit(1)

    if not my_address: 
        print("Error: Need Private Key or --to address")
        sys.exit(1)

    if args.action == 'portfolio':
        print(f"Scanning Portfolio for {my_address} on {config['name']}...")
        
        # 1. Get Candidate Tokens from History (Mock Indexer)
        candidates, native_bal = fetch_portfolio_from_api(my_address, w3.eth.chain_id, explorer_api_key)
        
        # 2. Fetch Prices
        print("Fetching market prices...")
        native_price = fetch_native_price(w3.eth.chain_id)
        token_prices = fetch_token_prices(w3.eth.chain_id, candidates)
        
        total_usd = 0.0
        
        native_val = float(native_bal) * native_price
        total_usd += native_val
        
        print(f"\n--- Portfolio Value: ---") 
        print(f"Native: {native_bal:.4f} {config['symbol']} (${native_val:.2f} @ ${native_price:.2f})")

        if candidates:
            # Minimal ABI for balance
            abi = [{"constant":True,"inputs":[{"name":"_owner","type":"address"}],"name":"balanceOf","outputs":[{"name":"balance","type":"uint256"}],"payable":False,"type":"function"},
                   {"constant":True,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"payable":False,"type":"function"},
                   {"constant":True,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"payable":False,"type":"function"}]
            
            for token in candidates:
                try:
                    checksum_addr = w3.to_checksum_address(token)
                    ctr = w3.eth.contract(address=checksum_addr, abi=abi)
                    bal = ctr.functions.balanceOf(my_address).call()
                    
                    if bal > 0:
                        dec = ctr.functions.decimals().call()
                        sym = ctr.functions.symbol().call()
                        readable = Decimal(bal) / Decimal(10**dec)
                        
                        price = token_prices.get(token.lower(), 0)
                        val = float(readable) * price
                        total_usd += val
                        
                        print(f"- {readable:.4f} {sym} (${val:.2f} @ ${price:.2f})")
                except:
                    pass
        else:
            print("No token activity found in recent history.")
            
        print(f"\nTotal Estimated Value: ${total_usd:.2f}")

    elif args.action == 'explorer':
        # Fallback to standard domains for browser viewing, as V2 API is for data
        bases = {
            137: "https://polygonscan.com",
            1: "https://etherscan.io",
            10: "https://optimistic.etherscan.io",
            42161: "https://arbiscan.io"
        }
        base = bases.get(w3.eth.chain_id, "https://etherscan.io")
        print(f"Explorer: {base}/address/{my_address}")

    elif args.action == 'balance':
        if args.token:
             # Resolve token address
             token_addr = args.token
             if not w3.is_address(token_addr):
                 print("Error: Please provide a valid Token Address for --token")
             else:
                 token_addr = w3.to_checksum_address(token_addr)
                 abi = [{"constant":True,"inputs":[{"name":"_owner","type":"address"}],"name":"balanceOf","outputs":[{"name":"balance","type":"uint256"}],"payable":False,"type":"function"},
                        {"constant":True,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"payable":False,"type":"function"},
                        {"constant":True,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"payable":False,"type":"function"}]
                 try:
                     ctr = w3.eth.contract(address=token_addr, abi=abi)
                     bal = ctr.functions.balanceOf(my_address).call()
                     dec = ctr.functions.decimals().call()
                     sym = ctr.functions.symbol().call()
                     print(f"Balance: {Decimal(bal)/Decimal(10**dec)} {sym}")
                 except Exception as e:
                     print(f"Error reading token: {e}")
        else:
             bal = w3.eth.get_balance(my_address)
             print(f"Balance: {w3.from_wei(bal, 'ether')} {config['symbol']}")

    elif args.action == 'transfer':
        if not private_key: print("Error: Private Key needed"); sys.exit(1)
        if not args.to or not args.amount: print("Error: --to and --amount required"); sys.exit(1)
        
        try:
            nonce = w3.eth.get_transaction_count(account.address)
            gas_fees = calc_gas_fees(w3)
            tx = {
                'nonce': nonce,
                'to': w3.to_checksum_address(args.to),
                'value': w3.to_wei(args.amount, 'ether'),
                'gas': 21000,
                'chainId': w3.eth.chain_id,
                'data': b''
            }
            tx.update(gas_fees)
            
            signed_tx = w3.eth.account.sign_transaction(tx, private_key)
            tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            print(f"Transaction Sent! Hash: {w3.to_hex(tx_hash)}")
        except Exception as e:
            print(f"Transfer failed: {e}")

    # --- DeFi Actions ---
    elif args.action == 'approve':
        if not private_key: print("Error: Private Key required"); sys.exit(1)
        if not args.token or not args.amount: print("Error: --token and --amount required"); sys.exit(1)
        
        router_addr = config.get('router')
        if not router_addr: print(f"Router not configured for {config['name']}"); sys.exit(1)
        
        try:
            token_addr = w3.to_checksum_address(args.token)
            abi = [{"constant":False,"inputs":[{"name":"_spender","type":"address"},{"name":"_value","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"payable":False,"type":"function"},
                   {"constant":True,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"payable":False,"type":"function"}]
            
            ctr = w3.eth.contract(address=token_addr, abi=abi)
            decimals = ctr.functions.decimals().call()
            amount_wei = int(args.amount * (10**decimals))
            
            print(f"Approving Router ({router_addr}) to spend {args.amount} of {args.token} on {config['name']}...")
            
            gas_fees = calc_gas_fees(w3)
            tx = ctr.functions.approve(router_addr, amount_wei).build_transaction({
                'from': account.address,
                'nonce': w3.eth.get_transaction_count(account.address),
                'chainId': w3.eth.chain_id
            })
            tx.update(gas_fees)
            
            signed = w3.eth.account.sign_transaction(tx, private_key)
            tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
            print(f"Approval Sent! Hash: {w3.to_hex(tx_hash)}")
        except Exception as e:
            print(f"Approval failed: {e}")

    elif args.action == 'swap':
        if not private_key: print("Error: Private Key required"); sys.exit(1)
        if not args.token_in or not args.token_out or not args.amount: 
            print("Error: --token-in, --token-out and --amount required"); sys.exit(1)

        router_addr = config.get('router')
        if not router_addr: print(f"Router not configured for {config['name']}"); sys.exit(1)

        try:
            token_in = w3.to_checksum_address(args.token_in)
            token_out = w3.to_checksum_address(args.token_out)
            
            # Get Decimals for Amount In
            abi_dec = [{"constant":True,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"payable":False,"type":"function"}]
            ctr_in = w3.eth.contract(address=token_in, abi=abi_dec)
            dec_in = ctr_in.functions.decimals().call()
            amount_in_wei = int(args.amount * (10**dec_in))
            
            # 1. Get Quote & Calculate Min Amount Out (Slippage Protection)
            print(f"checking price for {args.amount} on {config['name']} (Fee: {args.fee})...")
            expected_out_wei = get_quote(w3, token_in, token_out, amount_in_wei, args.fee)
            
            if not expected_out_wei:
                print("Error: Could not fetch price quote. Network busy or no liquidity.")
                sys.exit(1)

            slippage_pct = args.slippage
            min_out_wei = int(expected_out_wei * (1 - slippage_pct/100))
            
            print(f"Quoted Out: {expected_out_wei} (Wei)")
            print(f"Slippage: {slippage_pct}% -> Min Out: {min_out_wei} (Wei)")

            # Fee: from args
            fee = args.fee 
            
            # exactInputSingle params:
            # (tokenIn, tokenOut, fee, recipient, deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96)
            
            router_abi = [{
                "inputs": [
                    {
                        "components": [
                            {"internalType":"address","name":"tokenIn","type":"address"},
                            {"internalType":"address","name":"tokenOut","type":"address"},
                            {"internalType":"uint24","name":"fee","type":"uint24"},
                            {"internalType":"address","name":"recipient","type":"address"},
                            {"internalType":"uint256","name":"deadline","type":"uint256"},
                            {"internalType":"uint256","name":"amountIn","type":"uint256"},
                            {"internalType":"uint256","name":"amountOutMinimum","type":"uint256"},
                            {"internalType":"uint160","name":"sqrtPriceLimitX96","type":"uint160"}
                        ],
                        "internalType":"struct ISwapRouter.ExactInputSingleParams",
                        "name":"params",
                        "type":"tuple"
                    }
                ],
                "name":"exactInputSingle",
                "outputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"}],
                "stateMutability":"payable",
                "type":"function"
            }]
            
            router = w3.eth.contract(address=router_addr, abi=router_abi)
            
            params = (
                token_in,
                token_out,
                fee,
                account.address,
                int(time.time()) + 600, # 10 min deadline
                amount_in_wei,
                min_out_wei, # Slippage Protection Enforced!
                0
            )

            print(f"Swapping {args.amount} of {args.token_in} -> {args.token_out} on {config['name']}...")
            
            gas_fees = calc_gas_fees(w3)
            tx = router.functions.exactInputSingle(params).build_transaction({
                'from': account.address,
                'nonce': w3.eth.get_transaction_count(account.address),
                'chainId': w3.eth.chain_id
            })
            tx.update(gas_fees)
            
            signed = w3.eth.account.sign_transaction(tx, private_key)
            tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
            print(f"Swap Sent! Hash: {w3.to_hex(tx_hash)}")
            
        except Exception as e:
            print(f"Swap failed: {e}")

if __name__ == "__main__":
    main()
