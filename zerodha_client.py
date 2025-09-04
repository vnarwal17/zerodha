import os
import json
import logging
from datetime import datetime, time, timedelta
from typing import Optional, List, Dict, Any
from kiteconnect import KiteConnect, KiteTicker
import pandas as pd

logger = logging.getLogger(__name__)

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
        
        # Load saved token if exists and valid
        self._load_saved_token()
    
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
                'exchange': self.kite.EXCHANGE_NSE,
                'transaction_type': transaction_type,
                'quantity': quantity,
                'product': self.kite.PRODUCT_MIS,  # Intraday
                'order_type': self.kite.ORDER_TYPE_MARKET if price is None else self.kite.ORDER_TYPE_LIMIT,
                'variety': self.kite.VARIETY_REGULAR
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
    
    def get_kite_instance(self):
        """Get the KiteConnect instance for advanced operations"""
        return self.kite