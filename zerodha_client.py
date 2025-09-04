import os
import json
import logging
from datetime import datetime, time, timedelta
from typing import Optional, List, Dict, Any
from kiteconnect import KiteConnect
import pandas as pd

logger = logging.getLogger(__name__)

class ZerodhaClient:
    def __init__(self):
        # Try to get API credentials from environment variables first
        self.api_key = os.getenv('ZERODHA_API_KEY', 'your_zerodha_api_key')
        self.api_secret = os.getenv('ZERODHA_API_SECRET', 'your_zerodha_api_secret')
        
        # If no environment variables, try to load from config file
        if self.api_key == 'your_zerodha_api_key':
            self._load_config()
        
        if self.api_key == 'your_zerodha_api_key' or self.api_secret == 'your_zerodha_api_secret':
            logger.warning("Using placeholder API credentials. Please set ZERODHA_API_KEY and ZERODHA_API_SECRET environment variables or create zerodha_config.json")
        self.kite = KiteConnect(api_key=self.api_key)
        self.access_token = None
        self.user_id = None
        self.token_file = "access_token.json"
        self.instruments_cache = None
        
        # Load saved token if exists and valid
        self._load_saved_token()
    
    def _load_config(self):
        """Load API credentials from config file"""
        try:
            if os.path.exists('zerodha_config.json'):
                with open('zerodha_config.json', 'r') as f:
                    config = json.load(f)
                    self.api_key = config.get('api_key', self.api_key)
                    self.api_secret = config.get('api_secret', self.api_secret)
                    logger.info("Loaded API credentials from config file")
        except Exception as e:
            logger.error(f"Error loading config: {e}")
    
    def set_credentials(self, api_key: str, api_secret: str):
        """Set API credentials at runtime"""
        self.api_key = api_key
        self.api_secret = api_secret
        self.kite = KiteConnect(api_key=self.api_key)
        logger.info("API credentials updated")
    
    def _load_saved_token(self):
        """Load saved access token if it exists and is valid"""
        try:
            if os.path.exists(self.token_file):
                with open(self.token_file, 'r') as f:
                    token_data = json.load(f)
                
                # Check if token is still valid (expires at 6:30 AM next day)
                token_time = datetime.fromisoformat(token_data['timestamp'])
                now = datetime.now()
                
                # Token expires at 6:30 AM next day
                if token_time.date() == now.date() and now.time() < time(6, 30):
                    self.access_token = token_data['access_token']
                    self.user_id = token_data['user_id']
                    self.kite.set_access_token(self.access_token)
                    logger.info("Loaded saved access token")
                elif token_time.date() < now.date() and now.time() >= time(6, 30):
                    # Token expired, remove file
                    os.remove(self.token_file)
                    logger.info("Access token expired, removed")
        except Exception as e:
            logger.error(f"Error loading saved token: {e}")
    
    def _save_token(self, access_token: str, user_id: str):
        """Save access token to file"""
        try:
            token_data = {
                'access_token': access_token,
                'user_id': user_id,
                'timestamp': datetime.now().isoformat()
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
        """Get available instruments"""
        try:
            if self.instruments_cache is None:
                instruments = self.kite.instruments()
                
                # Filter for equity instruments
                equity_instruments = [
                    {
                        'symbol': inst['tradingsymbol'],
                        'name': inst['name'],
                        'token': inst['instrument_token'],
                        'exchange': inst['exchange'],
                        'is_nifty50': inst['tradingsymbol'] in self.get_nifty50_symbols(),
                        'is_banknifty': inst['tradingsymbol'] in self.get_banknifty_symbols()
                    }
                    for inst in instruments
                    if inst['exchange'] == 'NSE' and inst['segment'] == 'NSE'
                ]
                
                self.instruments_cache = equity_instruments
            
            return self.instruments_cache
        except Exception as e:
            logger.error(f"Instruments error: {e}")
            return []
    
    def get_nifty50_symbols(self) -> List[str]:
        """Get NIFTY 50 stock symbols"""
        return [
            'ADANIPORTS', 'ASIANPAINT', 'AXISBANK', 'BAJAJ-AUTO', 'BAJFINANCE',
            'BAJAJFINSV', 'BHARTIARTL', 'BPCL', 'BRITANNIA', 'CIPLA',
            'COALINDIA', 'DIVISLAB', 'DRREDDY', 'EICHERMOT', 'GRASIM',
            'HCLTECH', 'HDFC', 'HDFCBANK', 'HDFCLIFE', 'HEROMOTOCO',
            'HINDALCO', 'HINDUNILVR', 'ICICIBANK', 'INDUSINDBK', 'INFY',
            'IOC', 'ITC', 'JSWSTEEL', 'KOTAKBANK', 'LT', 'M&M',
            'MARUTI', 'NESTLEIND', 'NTPC', 'ONGC', 'POWERGRID',
            'RELIANCE', 'SBILIFE', 'SBIN', 'SHREECEM', 'SUNPHARMA',
            'TATACONSUM', 'TATAMOTORS', 'TATASTEEL', 'TCS', 'TECHM',
            'TITAN', 'ULTRACEMCO', 'UPL', 'WIPRO'
        ]
    
    def get_banknifty_symbols(self) -> List[str]:
        """Get Bank NIFTY stock symbols"""
        return [
            'AXISBANK', 'BANDHANBNK', 'FEDERALBNK', 'HDFCBANK', 'ICICIBANK',
            'IDFCFIRSTB', 'INDUSINDBK', 'KOTAKBANK', 'PNB', 'SBIN'
        ]
    
    async def get_historical_data(self, instrument_token: int, from_date: str, to_date: str, interval: str) -> List[Dict]:
        """Get historical candlestick data"""
        try:
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
        """Get Last Traded Price for instruments"""
        try:
            ltp_data = self.kite.ltp(instruments)
            return {inst: data['last_price'] for inst, data in ltp_data.items()}
        except Exception as e:
            logger.error(f"LTP error: {e}")
            return {}
    
    async def place_order(self, symbol: str, transaction_type: str, quantity: int, price: Optional[float] = None) -> Dict[str, Any]:
        """Place an order"""
        try:
            order_params = {
                'tradingsymbol': symbol,
                'exchange': 'NSE',
                'transaction_type': transaction_type,
                'quantity': quantity,
                'product': 'MIS',  # Intraday
                'order_type': 'MARKET' if price is None else 'LIMIT',
            }
            
            if price:
                order_params['price'] = price
            
            order_id = self.kite.place_order(**order_params)
            return {'status': 'success', 'order_id': order_id}
        except Exception as e:
            logger.error(f"Order placement error: {e}")
            return {'status': 'error', 'message': str(e)}
    
    async def get_positions(self) -> List[Dict[str, Any]]:
        """Get current positions"""
        try:
            positions = self.kite.positions()
            return positions['day']  # Day positions for intraday
        except Exception as e:
            logger.error(f"Positions error: {e}")
            return []