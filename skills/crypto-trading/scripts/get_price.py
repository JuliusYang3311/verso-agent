import sys
import json
import urllib.request
import urllib.error

def get_price(crypto_id, vs_currency='usd'):
    url = f"https://api.coingecko.com/api/v3/simple/price?ids={crypto_id}&vs_currencies={vs_currency}"
    
    try:
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode())
            if crypto_id in data and vs_currency in data[crypto_id]:
                return data[crypto_id][vs_currency]
            else:
                return None
    except urllib.error.URLError as e:
        print(f"Error fetching price: {e}", file=sys.stderr)
        return None

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 get_price.py <crypto_id> [vs_currency]")
        sys.exit(1)

    crypto_id = sys.argv[1].lower()
    vs_currency = sys.argv[2].lower() if len(sys.argv) > 2 else 'usd'

    price = get_price(crypto_id, vs_currency)

    if price is not None:
        print(f"The price of {crypto_id} is {price} {vs_currency.upper()}")
    else:
        print(f"Could not fetch price for {crypto_id} in {vs_currency}")
        sys.exit(1)
