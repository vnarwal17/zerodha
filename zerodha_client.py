import os
import json
import logging
import asyncio
import collections
import time as time_module
from datetime import datetime, time, timedelta, timezone
from typing import Optional, List, Dict, Any
from kiteconnect import KiteConnect, KiteTicker
from kiteconnect.exceptions import TokenException, NetworkException, InputException, KiteException
import pandas as pd
import requests

logger = logging.getLogger(__name__)

class TradingBotException(Exception):
    def __init__(self, message: str, error_code: str, status_code: int = 400):
        self.message = message
        self.error_code = error_code
        self.status_code = status_code
        super().__init__(self.message)

class RateLimitedKiteClient:
    def __init__(self):
        self.historical_semaphore = asyncio.Semaphore(3)  # 3 req/sec for historical
        self.order_semaphore = asyncio.Semaphore(10)      # 10 req/sec for orders
        self.quote_semaphore = asyncio.Semaphore(1)       # 1 req/sec for quotes
        self.request_times = collections.deque(maxlen=120)

class ZerodhaClient:
    def __init__(self):
        # Use your working credentials
        self.api_key = "graf84f2wec04nbl"
        self.api_secret = "rcaxwf44jd6en5yujwzgmm36hbwbffz6"
        self.user_id = "YDD304"
        
        self.kite = KiteConnect(api_key=self.api_key)
        self.access_token = None
        self.token_file = "access_token.json"
        self.instruments_cache = None
        self.token_expires_at = None
        
        # Rate limiting
        self.rate_limiter = RateLimitedKiteClient()
        
        # Load saved token if exists and valid
        self._load_saved_token()
    
    def _load_saved_token(self):
        """Load saved access token if it exists and is valid"""
        try:
            if os.path.exists(self.token_file):
                with open(self.token_file, 'r') as f:
                    token_data = json.load(f)
                
                # Check if token is still valid (variable 5:00-7:30 AM IST expiry)
                token_time = datetime.fromisoformat(token_data['timestamp'])
                now = datetime.now(timezone(timedelta(hours=5, minutes=30)))  # IST
                
                # Calculate next expiry time (variable between 5:00-7:30 AM next day)
                next_day = (token_time + timedelta(days=1)).date()
                expiry_start = datetime.combine(next_day, time(5, 0)).replace(tzinfo=timezone(timedelta(hours=5, minutes=30)))
                expiry_end = datetime.combine(next_day, time(7, 30)).replace(tzinfo=timezone(timedelta(hours=5, minutes=30)))
                
                if now < expiry_start:
                    self.access_token = token_data['access_token']
                    self.user_id = token_data['user_id']
                    self.token_expires_at = expiry_start
                    self.kite.set_access_token(self.access_token)
                    logger.info("Loaded saved access token")
                else:
                    # Token expired, remove file
                    os.remove(self.token_file)
                    logger.info("Access token expired, removed")
        except Exception as e:
            logger.error(f"Error loading saved token: {e}")
    
    def is_token_expired(self):
        """Check if token is near expiry (within 30 minutes)"""
        if self.token_expires_at:
            return datetime.now(timezone(timedelta(hours=5, minutes=30))) > (self.token_expires_at - timedelta(minutes=30))
        return True

    async def refresh_session_if_needed(self):
        """Proactively refresh token before expiry"""
        if self.is_token_expired():
            await self.refresh_access_token()

    async def refresh_access_token(self):
        """Refresh the access token"""
        try:
            # Force user to re-authenticate
            self.access_token = None
            if os.path.exists(self.token_file):
                os.remove(self.token_file)
            logger.warning("Token expired - user needs to re-authenticate")
            raise TradingBotException("Session expired - please login again", "SESSION_EXPIRED")
        except Exception as e:
            logger.error(f"Token refresh error: {e}")
            raise

    def handle_token_exception(self, func):
        """Decorator to handle token expiry during API calls"""
        try:
            return func()
        except TokenException:
            asyncio.create_task(self.refresh_access_token())
            return func()  # Retry once after refresh
    
    def _save_token(self, access_token: str, user_id: str):
        """Save access token to file"""
        try:
            # Set expiry to next day 5:00 AM IST
            now = datetime.now(timezone(timedelta(hours=5, minutes=30)))
            next_day = (now + timedelta(days=1)).date()
            self.token_expires_at = datetime.combine(next_day, time(5, 0)).replace(tzinfo=timezone(timedelta(hours=5, minutes=30)))
            
            token_data = {
                'access_token': access_token,
                'user_id': user_id,
                'timestamp': now.isoformat(),
                'expires_at': self.token_expires_at.isoformat()
            }
            with open(self.token_file, 'w') as f:
                json.dump(token_data, f)
            logger.info("Access token saved")
        except Exception as e:
            logger.error(f"Error saving token: {e}")
    
    def get_login_url(self) -> str:
        """Get Zerodha login URL"""
        return self.kite.login_url()
    
    async def complete_login(self, request_token: str) -> Dict[str, Any]:
        """Complete login with request token"""
        try:
            data = self.kite.generate_session(request_token, api_secret=self.api_secret)
            self.access_token = data["access_token"]
            self.user_id = data["user_id"]
            self.kite.set_access_token(self.access_token)
            
            # Save token for future use
            self._save_token(self.access_token, self.user_id)
            
            return {
                'status': 'success',
                'user_id': self.user_id,
                'message': 'Login successful'
            }
        except Exception as e:
            logger.error(f"Login completion error: {e}")
            return {
                'status': 'error',
                'message': str(e)
            }
    
    def is_connected(self) -> bool:
        """Check if connected to Zerodha"""
        return self.access_token is not None
    
    async def get_profile(self) -> Dict[str, Any]:
        """Get user profile"""
        try:
            profile = self.kite.profile()
            return {
                'user_id': profile['user_id'],
                'user_name': profile['user_name'],
                'email': profile['email']
            }
        except Exception as e:
            logger.error(f"Profile error: {e}")
            raise
    
    async def get_instruments(self) -> List[Dict[str, Any]]:
        """Get available instruments with Nifty50/BankNifty flags"""
        try:
            if self.instruments_cache is None:
                instruments = self.kite.instruments("NSE")
                
                # Filter for equity instruments
                equity_instruments = []
                for inst in instruments:
                    if inst['exchange'] == 'NSE' and inst['instrument_type'] == 'EQ':
                        symbol = inst['tradingsymbol']
                        equity_instruments.append({
                            'symbol': symbol,
                            'name': inst['name'],
                            'token': inst['instrument_token'],
                            'exchange': inst['exchange'],
                            'is_nifty50': symbol in self.get_nifty50_symbols(),
                            'is_banknifty': symbol in self.get_banknifty_symbols()
                        })
                
                self.instruments_cache = equity_instruments
            
            return self.instruments_cache
        except Exception as e:
            logger.error(f"Instruments error: {e}")
            return []
    
    def get_nifty50_symbols(self) -> List[str]:
        """Get NIFTY 50 stock symbols"""
        return [
            'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'HINDUNILVR', 'ICICIBANK', 'HDFC', 'SBIN', 
            'BHARTIARTL', 'KOTAKBANK', 'BAJFINANCE', 'LT', 'ITC', 'ASIANPAINT', 'AXISBANK', 
            'DMART', 'SUNPHARMA', 'ULTRACEMCO', 'TITAN', 'NESTLEIND', 'WIPRO', 'MARUTI', 
            'M&M', 'HCLTECH', 'NTPC', 'TATAMOTORS', 'POWERGRID', 'ONGC', 'JSWSTEEL', 'GRASIM',
            'TATASTEEL', 'TECHM', 'INDUSINDBK', 'HINDALCO', 'DIVISLAB', 'DRREDDY', 'BAJAJFINSV',
            'CIPLA', 'BPCL', 'BRITANNIA', 'SBILIFE', 'EICHERMOT', 'UPL', 'COALINDIA', 'SHREECEM',
            'BAJAJ-AUTO', 'HEROMOTOCO', 'TATACONSUM', 'ADANIPORTS', 'APOLLOHOSP'
        ]
    
    def get_banknifty_symbols(self) -> List[str]:
        """Get Bank NIFTY stock symbols"""
        return [
            'HDFCBANK', 'ICICIBANK', 'KOTAKBANK', 'AXISBANK', 'SBIN', 'INDUSINDBK',
            'BANDHANBNK', 'FEDERALBNK', 'IDFCFIRSTB', 'PNB', 'BANKBARODA', 'AUBANK'
        ]
    
    async def get_historical_data(self, instrument_token: int, from_date: str, to_date: str, interval: str) -> List[Dict]:
        """Get historical candlestick data with rate limiting"""
        try:
            # Rate limiting for historical data
            await asyncio.sleep(0.34)  # Ensure 3 req/sec compliance
            async with self.rate_limiter.historical_semaphore:
                self.rate_limiter.request_times.append(time_module.time())
                
                data = self.kite.historical_data(
                    instrument_token=instrument_token,
                    from_date=from_date,
                    to_date=to_date,
                    interval=interval
                )
                return data
        except Exception as e:
            logger.error(f"Historical data error: {e}")
            return []
    
    async def get_ltp(self, instruments: List[str]) -> Dict[str, float]:
        """Get Last Traded Price for instruments with rate limiting"""
        try:
            async with self.rate_limiter.quote_semaphore:
                ltp_data = self.kite.ltp(instruments)
                return {inst: data['last_price'] for inst, data in ltp_data.items()}
        except Exception as e:
            logger.error(f"LTP error: {e}")
            return {}
    
    async def place_order(self, symbol: str, transaction_type: str, quantity: int, price: Optional[float] = None) -> Dict[str, Any]:
        """Place an order using form-encoded data (CRITICAL FIX)"""
        try:
            # Rate limiting for orders
            async with self.rate_limiter.order_semaphore:
                # Format symbol correctly for NSE
                if not symbol.endswith('-EQ'):
                    trading_symbol = f"{symbol}-EQ"
                else:
                    trading_symbol = symbol
                    
                # Order data in exact format as specified
                order_data = {
                    'variety': 'regular',
                    'exchange': 'NSE', 
                    'tradingsymbol': trading_symbol,
                    'transaction_type': transaction_type,
                    'order_type': 'LIMIT' if price else 'MARKET',
                    'quantity': str(quantity),  # Convert to string for form data
                    'product': 'MIS',
                    'validity': 'DAY',
                    'disclosed_quantity': '0',
                    'trigger_price': '0',
                    'squareoff': '0',
                    'stoploss': '0',
                    'trailing_stoploss': '0'
                }
                
                if price:
                    order_data['price'] = str(price)
                
                # CRITICAL FIX: Use form-encoded data instead of JSON
                headers = {
                    'X-Kite-Version': '3',
                    'Authorization': f'token {self.api_key}:{self.access_token}',
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
                
                url = f"https://api.kite.trade/orders/{order_data['variety']}"
                
                logger.info(f"Placing order: {order_data}")
                
                # Use requests.post with data parameter (form-encoded)
                response = requests.post(url, data=order_data, headers=headers)
                
                if response.status_code == 200:
                    result = response.json()
                    order_id = result.get('data', {}).get('order_id')
                    
                    # Verify order status
                    await asyncio.sleep(1)
                    order_status = await self.verify_order_status(order_id)
                    
                    return {'status': 'success', 'order_id': order_id, 'order_status': order_status}
                else:
                    error_msg = response.json().get('message', 'Order placement failed')
                    logger.error(f"Order placement failed: {error_msg}")
                    return {'status': 'error', 'message': error_msg}
                    
        except Exception as e:
            logger.error(f"Order placement error: {e}")
            return {'status': 'error', 'message': str(e)}

    async def verify_order_status(self, order_id: str) -> str:
        """Verify order execution status"""
        try:
            order_history = self.kite.order_history(order_id)
            if order_history:
                latest_status = order_history[-1]['status']
                if latest_status not in ['COMPLETE', 'OPEN']:
                    logger.warning(f"Order {order_id} status: {latest_status}")
                return latest_status
            return "UNKNOWN"
        except Exception as e:
            logger.error(f"Order status verification error: {e}")
            return "ERROR"
    
    async def get_positions(self) -> List[Dict[str, Any]]:
        """Get current positions"""
        try:
            positions = self.kite.positions()
            return positions['day']  # Day positions for intraday
        except Exception as e:
            logger.error(f"Positions error: {e}")
            return []
    
    def get_kite_instance(self):
        """Get the KiteConnect instance for advanced operations"""
        return self.kite