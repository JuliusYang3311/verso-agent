import sys
import os
import argparse
import json
import requests
import time
from decimal import Decimal

# Check for Web3
try:
    from web3 import Web3
    from web3.middleware import geth_poa_middleware
except ImportError:
    print("Error: 'web3' library is not installed. Please install it with 'pip install web3'.")
    sys.exit(1)

# --- Configuration ---
UNIFIED_API_URL = "https://api.etherscan.io/v2/api"

CHAIN_CONFIG = {
    137: {
        'name': 'Polygon',
        'symbol': 'POL',
        'router': "0xE592427A0AEce92De3Edee1F18E0157C05861564", # Uniswap V3
        'quoter': "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", 
        'rpc_fallbacks': ['https://polygon-rpc.com', 'https://1rpc.io/matic']
    },
    1: {
        'name': 'Ethereum',
        'symbol': 'ETH',
        'router': "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        'quoter': "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        'rpc_fallbacks': ['https://cloudflare-eth.com']
    },
    10: {
        'name': 'Optimism', 
        'symbol': 'ETH',
        'router': "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        'quoter': "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        'rpc_fallbacks': ['https://mainnet.optimism.io']
    },
    42161: {
        'name': 'Arbitrum',
        'symbol': 'ETH',
        'router': "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        'quoter': "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        'rpc_fallbacks': ['https://arb1.arbitrum.io/rpc']
    }
}

DEFAULT_CONFIG = {'name': 'Unknown', 'symbol': 'ETH', 'router': None, 'quoter': None}

def get_chain_config(chain_id):
    return CHAIN_CONFIG.get(chain_id, DEFAULT_CONFIG)

# --- Helpers ---

def get_web3_with_fallback(primary_url):
    candidates = [primary_url]
    # Simple auto-fallback logic could rely on chain ID config effectively
    # Here we just blindly try the primary first
    for url in candidates:
        if not url: continue
        try:
            w3 = Web3(Web3.HTTPProvider(url, request_kwargs={'timeout': 10}))
            w3.middleware_onion.inject(geth_poa_middleware, layer=0)
            if w3.is_connected(): return w3
        except: continue
    print("Error: Could not connect to RPC.")
    sys.exit(1)

def calc_gas_fees(w3):
    try:
        latest = w3.eth.get_block("latest")
        base_fee = latest['baseFeePerGas']
        # Aggressive for Arb
        priority_fee = w3.to_wei(35, 'gwei') 
        max_fee = (2 * base_fee) + priority_fee
        return {'maxFeePerGas': max_fee, 'maxPriorityFeePerGas': priority_fee}
    except:
        return {'gasPrice': w3.eth.gas_price}

def fetch_token_prices(chain_id, contract_addresses):
    if not contract_addresses: return {}
    platforms = { 137: 'polygon-pos', 1: 'ethereum', 10: 'optimism-ethereum', 42161: 'arbitrum-one' }
    platform = platforms.get(chain_id, 'polygon-pos')
    results = {}
    
    # Chunking to avoid URL length issues
    chunk_size = 10
    chunks = [contract_addresses[i:i + chunk_size] for i in range(0, len(contract_addresses), chunk_size)]
    
    for chunk in chunks:
        ids = ','.join(chunk)
        url = f"https://api.coingecko.com/api/v3/simple/token_price/{platform}?contract_addresses={ids}&vs_currencies=usd"
        try:
            resp = requests.get(url, timeout=10).json()
            for k, v in resp.items():
                if isinstance(v, dict): results[k.lower()] = v.get('usd', 0)
            time.sleep(1) # Polite delay
        except: pass
    return results

def get_quote(w3, token_in, token_out, amount_in_wei, fee=3000):
    config = get_chain_config(w3.eth.chain_id)
    quoter_addr = config.get('quoter')
    if not quoter_addr: return None

    # QuoterV2 quoteExactInputSingle
    abi = [{"inputs":[{"components":[{"internalType":"address","name":"tokenIn","type":"address"},{"internalType":"address","name":"tokenOut","type":"address"},{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"uint24","name":"fee","type":"uint24"},{"internalType":"uint160","name":"sqrtPriceLimitX96","type":"uint160"}],"internalType":"struct IQuoterV2.QuoteExactInputSingleParams","name":"params","type":"tuple"}],"name":"quoteExactInputSingle","outputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"},{"internalType":"uint160","name":"sqrtPriceX96After","type":"uint160"},{"internalType":"uint32","name":"initializedTicksCrossed","type":"uint32"},{"internalType":"uint256","name":"gasEstimate","type":"uint256"}],"stateMutability":"nonpayable","type":"function"}]
    
    try:
        quoter = w3.eth.contract(address=quoter_addr, abi=abi)
        params = (token_in, token_out, amount_in_wei, fee, 0)
        # MUST use call()
        res = quoter.functions.quoteExactInputSingle(params).call()
        return res[0]
    except: return None

# --- Actions ---

def perform_swap(w3, private_key, token_in, token_out, amount_val, fee=3000):
    """Executes a swap from token_in to token_out."""
    account = w3.eth.account.from_key(private_key)
    config = get_chain_config(w3.eth.chain_id)
    router_addr = config.get('router')
    
    t_in_addr = w3.to_checksum_address(token_in)
    t_out_addr = w3.to_checksum_address(token_out)
    
    # ABI
    abi_erc20 = [{"constant":True,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"type":"function"},
                 {"constant":False,"inputs":[{"name":"_spender","type":"address"},{"name":"_value","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"type":"function"},
                 {"constant":True,"inputs":[{"name":"_owner","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"type":"function"}]

    ctr_in = w3.eth.contract(address=t_in_addr, abi=abi_erc20)
    
    try:
        dec = ctr_in.functions.decimals().call()
    except: dec = 18
    
    amount_wei = int(amount_val * (10**dec))
    bal = ctr_in.functions.balanceOf(account.address).call()
    
    if bal < amount_wei:
        print(f"❌ Failed: Insufficient {amount_val} for swap (Bal: {bal/10**dec})")
        return False

    print(f"🔄 Swapping {amount_val} -> Output...")
    
    try:
        # Approve
        print("  Approving...")
        gas = calc_gas_fees(w3)
        tx_app = ctr_in.functions.approve(router_addr, amount_wei).build_transaction({
            'from': account.address, 'nonce': w3.eth.get_transaction_count(account.address), 'chainId': w3.eth.chain_id
        })
        tx_app.update(gas)
        s_app = w3.eth.account.sign_transaction(tx_app, private_key)
        w3.eth.send_raw_transaction(s_app.rawTransaction)
        
        # Simple wait loop
        time.sleep(5) 
        
        # Swap
        router_abi = [{"inputs":[{"components":[{"internalType":"address","name":"tokenIn","type":"address"},{"internalType":"address","name":"tokenOut","type":"address"},{"internalType":"uint24","name":"fee","type":"uint24"},{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"deadline","type":"uint256"},{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"uint256","name":"amountOutMinimum","type":"uint256"},{"internalType":"uint160","name":"sqrtPriceLimitX96","type":"uint160"}],"internalType":"struct ISwapRouter.ExactInputSingleParams","name":"params","type":"tuple"}],"name":"exactInputSingle","outputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"}],"stateMutability":"payable","type":"function"}]
        router = w3.eth.contract(address=router_addr, abi=router_abi)
        
        params = (t_in_addr, t_out_addr, fee, account.address, int(time.time())+300, amount_wei, 0, 0)
        
        gas = calc_gas_fees(w3)
        tx_s = router.functions.exactInputSingle(params).build_transaction({
            'from': account.address, 'nonce': w3.eth.get_transaction_count(account.address), 'chainId': w3.eth.chain_id
        })
        tx_s.update(gas)
        s_s = w3.eth.account.sign_transaction(tx_s, private_key)
        h = w3.eth.send_raw_transaction(s_s.rawTransaction)
        print(f"✅ Tx Sent: {w3.to_hex(h)}")
        return True
    except Exception as e:
        print(f"❌ Swap Error: {e}")
        return False

def fetch_1inch_tokens(chain_id):
    try:
        url = f"https://tokens.1inch.io/v1.1/{chain_id}"
        resp = requests.get(url, timeout=5).json()
        token_map = {}
        for addr, data in resp.items():
            sym = data.get('symbol', '').upper()
            if sym: token_map[sym] = addr
        return token_map
    except: return {}

def monitor_arbitrage(w3, config, auto_trade, private_key, interval, target_tokens=None):
    chain_id = w3.eth.chain_id
    print(f"🚀 Arbitrage Monitor running on {config['name']} (Interval: {interval}s)")
    if auto_trade: print("⚠️ AUTO-TRADE ENABLED: Will execute trades > 2.0% profit")
    
    print("Fetching global token list...")
    global_map = fetch_1inch_tokens(chain_id)
    
    # Core + Hot
    tokens = {
        'WPOL': '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
        'USDC': '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        'WETH': '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
        'WBTC': '0x1BFD67037B42Cf73acf2047067bd4F2C47D9BfD6',
        'USDT': '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        'DAI': '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'
    }
    
    # Custom
    if target_tokens:
        t_list = [t.strip().upper() for t in target_tokens.split(',')]
        tokens = {} # Reset if custom
        for t in t_list:
             if t in global_map: tokens[t] = global_map[t]
             
    # ensure USDC for quote
    if 'USDC' not in tokens and 'USDC' in global_map:
        tokens['USDC'] = global_map['USDC']
        
    usdc = tokens.get('USDC')
    if not usdc: print("Error: USDC not found"); return

    while True:
        try:
            ts = time.strftime('%H:%M:%S')
            print(f"\n[{ts}] Scanning {len(tokens)} assets...")
            
            # 1. Market Prices
            addrs = list(tokens.values())
            market_prices = fetch_token_prices(chain_id, addrs)
            
            for sym, addr in tokens.items():
                if sym in ['USDC', 'USDT']: continue
                
                m_price = market_prices.get(addr.lower(), 0)
                if m_price == 0: continue
                
                dec_c = 8 if sym == 'WBTC' else 18
                if sym in ['USDT', 'USDC']: dec_c = 6
                
                # Check Sell Price (Token -> USDC)
                amt_in = int(1 * 10**dec_c)
                q = get_quote(w3, w3.to_checksum_address(addr), w3.to_checksum_address(usdc), amt_in, 3000)
                if not q: q = get_quote(w3, w3.to_checksum_address(addr), w3.to_checksum_address(usdc), amt_in, 500)
                
                if q:
                    c_price = float(q) / 10**6 # USDC 6
                    diff = ((c_price - m_price) / m_price) * 100
                    
                    if diff > 2.0:
                        print(f"💰 SELL SIGNAL: {sym} Chain ${c_price:.2f} > Market ${m_price:.2f} (+{diff:.2f}%)")
                        if auto_trade:
                            perform_swap(w3, private_key, addr, usdc, 0.1) # Sell 0.1 Unit
                    elif diff < -2.0:
                        print(f"💰 BUY SIGNAL: {sym} Chain ${c_price:.2f} < Market ${m_price:.2f} ({diff:.2f}%)")
                        # Buy means: Sell USDC -> Buy Token
                        if auto_trade:
                             perform_swap(w3, private_key, usdc, addr, 5.0) # Buy $5 worth
                    else:
                        print(f"{sym}: ${c_price:.3f} ({diff:+.2f}%)")
            
            print(f"Sleeping {interval}s...")
            time.sleep(interval)
        except KeyboardInterrupt: break
        except Exception as e: print(f"Monitor Err: {e}"); time.sleep(15)

def fetch_portfolio_from_api(address, chain_id, api_key=None):
    base_url = UNIFIED_API_URL
    native_bal = 0
    try:
        url = f"{base_url}?chainid={chain_id}&module=account&action=balance&address={address}&tag=latest"
        if api_key: url += f"&apikey={api_key}"
        r = requests.get(url, timeout=5).json()
        if r['status'] == '1': native_bal = Decimal(r['result']) / Decimal(10**18)
    except: pass

    candidates = set()
    try:
        url = f"{base_url}?chainid={chain_id}&module=account&action=tokentx&address={address}&page=1&offset=100&sort=desc"
        if api_key: url += f"&apikey={api_key}"
        r = requests.get(url, timeout=5).json()
        if r['status'] == '1':
             for tx in r['result']: candidates.add(tx['contractAddress'])
    except: pass
    return list(candidates), native_bal

# --- Main ---

def main():
    parser = argparse.ArgumentParser(description='Verso EVM Wallet')
    parser.add_argument('--action', required=True, choices=['balance', 'transfer', 'portfolio', 'explorer', 'approve', 'swap', 'quote', 'history', 'monitor'])
    # Args
    parser.add_argument('--network', default='polygon')
    parser.add_argument('--to'); parser.add_argument('--amount', type=float); parser.add_argument('--token')
    
    # Swap args
    parser.add_argument('--token-in'); parser.add_argument('--token-out'); parser.add_argument('--fee', type=int, default=3000)
    parser.add_argument('--slippage', type=float, default=0.5)
    
    # Monitor args
    parser.add_argument('--tokens')
    parser.add_argument('--auto-trade', action='store_true')
    parser.add_argument('--interval', type=int, default=900)

    # Legacy
    parser.add_argument('--rpc'); parser.add_argument('--api-key')
    
    args = parser.parse_args()

    # Config
    env_key = os.getenv('ALCHEMY_API_KEY')
    priv_key = os.getenv('WALLET_PRIVATE_KEY')
    config_path = os.path.expanduser("~/.verso/verso.json")
    
    if os.path.exists(config_path):
        try:
             with open(config_path) as f:
                 c = json.load(f).get('crypto', {})
                 if c.get('enabled'):
                     env_key = c.get('alchemyApiKey', env_key)
                     priv_key = c.get('privateKey', priv_key)
        except: pass
        
    # Build RPC
    rpc_url = args.rpc
    if not rpc_url:
        if not env_key: print("Error: No ALCHEMY_API_KEY"); sys.exit(1)
        # simplistic mapping
        net = args.network
        if net == 'polygon': sub = 'polygon-mainnet'
        elif net == 'ethereum': sub = 'eth-mainnet'
        elif net == 'optimism': sub = 'opt-mainnet'
        elif net == 'arbitrum': sub = 'arb-mainnet'
        else: sub = 'polygon-mainnet'
        rpc_url = f"https://{sub}.g.alchemy.com/v2/{env_key}"

    w3 = get_web3_with_fallback(rpc_url)
    config = get_chain_config(w3.eth.chain_id)
    
    account = w3.eth.account.from_key(priv_key) if priv_key else None
    my_addr = account.address if account else args.to

    # Actions Dispatch
    if args.action == 'monitor':
        if args.auto_trade and not priv_key:
            print("Error: Auto-Trade needs Private Key"); sys.exit(1)
        monitor_arbitrage(w3, config, args.auto_trade, priv_key, args.interval, args.tokens)
        
    elif args.action == 'balance':
        if args.token:
            # Token Balance
            abi = [{"constant":True,"inputs":[{"name":"_owner","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"type":"function"},
                   {"constant":True,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"type":"function"},
                   {"constant":True,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"type":"function"}]
            try:
                c = w3.eth.contract(address=w3.to_checksum_address(args.token), abi=abi)
                b = c.functions.balanceOf(my_addr).call()
                d = c.functions.decimals().call()
                s = c.functions.symbol().call()
                print(f"Balance: {b/10**d} {s}")
            except Exception as e: print(f"Error: {e}")
        else:
            b = w3.eth.get_balance(my_addr)
            print(f"Native Balance: {w3.from_wei(b, 'ether')} {config['symbol']}")
            
    elif args.action == 'portfolio':
        print(f"Scanning Portfolio {my_addr}...")
        cands, n_bal = fetch_portfolio_from_api(my_addr, w3.eth.chain_id, args.api_key)
        print(f"Native: {n_bal:.4f} {config['symbol']}")
        t_prices = fetch_token_prices(w3.eth.chain_id, cands)
        
        abi = [{"constant":True,"inputs":[{"name":"_owner","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"type":"function"},
               {"constant":True,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"type":"function"},
               {"constant":True,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"type":"function"}]
               
        for t in cands:
             try:
                 c = w3.eth.contract(address=w3.to_checksum_address(t), abi=abi)
                 b = c.functions.balanceOf(my_addr).call()
                 if b > 0:
                     d = c.functions.decimals().call()
                     s = c.functions.symbol().call()
                     val = b / 10**d
                     p = t_prices.get(t.lower(), 0)
                     usd = val * p
                     print(f"- {val:.4f} {s} (${usd:.2f})")
             except: pass

    elif args.action == 'transfer':
        if not priv_key: print("Need Key"); sys.exit(1)
        gas = calc_gas_fees(w3)
        tx = {
            'to': w3.to_checksum_address(args.to),
            'value': w3.to_wei(args.amount, 'ether'),
            'nonce': w3.eth.get_transaction_count(account.address),
            'chainId': w3.eth.chain_id,
            'gas': 21000
        }
        tx.update(gas)
        s = w3.eth.account.sign_transaction(tx, priv_key)
        h = w3.eth.send_raw_transaction(s.rawTransaction)
        print(f"Sent: {w3.to_hex(h)}")
        
    elif args.action == 'swap':
        if not priv_key: print("Need Key"); sys.exit(1)
        perform_swap(w3, priv_key, args.token_in, args.token_out, args.amount, args.fee)
        
    elif args.action == 'quote':
        t_in = w3.to_checksum_address(args.token_in)
        t_out = w3.to_checksum_address(args.token_out)
        amt = int(args.amount * 10**18) # simplify assumptions for helper
        q = get_quote(w3, t_in, t_out, amt, args.fee)
        if q: print(f"Quote Out: {q}")
        else: print("Quote Failed")

if __name__ == "__main__":
    main()
