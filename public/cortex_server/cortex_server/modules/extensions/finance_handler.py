# Auto-generated skill: finance_handler
# Generated: Level 13 Materialization
# Gap: Price lookup failures detected
# Status: Installed

"""Finance Handler - Stock and crypto price lookup skill.

This module provides financial data retrieval capabilities.
"""
import requests
from typing import Dict, Optional


class FinanceHandler:
    """Handler for financial data queries.
    
    Supports stock prices via Yahoo Finance API and crypto via CoinGecko.
    """
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Cortex Finance Handler)"
        })
    
    def get_stock_price(self, symbol: str) -> Dict:
        """Get current stock price for a symbol.
        
        Args:
            symbol: Stock ticker symbol (e.g., "AAPL", "TSLA")
            
        Returns:
            Dict with price, change, and currency
        """
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol.upper()}"
            resp = self.session.get(url, timeout=10)
            data = resp.json()
            
            result = data["chart"]["result"][0]
            meta = result["meta"]
            price = meta.get("regularMarketPrice", 0)
            prev = meta.get("previousClose", 0)
            change = ((price - prev) / prev * 100) if prev else 0
            
            return {
                "symbol": symbol.upper(),
                "price": round(price, 2),
                "change_percent": round(change, 2),
                "currency": meta.get("currency", "USD"),
                "status": "success"
            }
        except Exception as e:
            return {
                "symbol": symbol.upper(),
                "error": str(e),
                "status": "failed"
            }
    
    def get_crypto_price(self, coin: str) -> Dict:
        """Get current crypto price from CoinGecko.
        
        Args:
            coin: Coin ID (e.g., "bitcoin", "ethereum")
            
        Returns:
            Dict with price and market data
        """
        try:
            url = f"https://api.coingecko.com/api/v3/simple/price"
            params = {
                "ids": coin.lower(),
                "vs_currencies": "usd",
                "include_24hr_change": "true"
            }
            resp = self.session.get(url, params=params, timeout=10)
            data = resp.json()
            
            coin_data = data.get(coin.lower(), {})
            price = coin_data.get("usd", 0)
            change = coin_data.get("usd_24h_change", 0)
            
            return {
                "coin": coin.lower(),
                "price_usd": round(price, 2),
                "change_24h_percent": round(change, 2),
                "status": "success"
            }
        except Exception as e:
            return {
                "coin": coin.lower(),
                "error": str(e),
                "status": "failed"
            }
    
    def get_price(self, query: str) -> Dict:
        """Auto-detect and get price for stock or crypto.
        
        Args:
            query: Symbol or coin name
            
        Returns:
            Price data dict
        """
        # Try stock first (common symbols)
        if query.upper() in ["AAPL", "TSLA", "GOOGL", "MSFT", "AMZN", "BTC", "ETH"]:
            return self.get_stock_price(query)
        
        # Try crypto
        crypto_result = self.get_crypto_price(query.lower())
        if crypto_result["status"] == "success":
            return crypto_result
        
        # Fallback to stock
        return self.get_stock_price(query)
