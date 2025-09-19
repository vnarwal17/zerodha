import logging
from datetime import datetime
from typing import Dict, List, Any

logger = logging.getLogger(__name__)

class TradingBotException(Exception):
    def __init__(self, message: str, error_code: str, status_code: int = 400):
        self.message = message
        self.error_code = error_code
        self.status_code = status_code
        super().__init__(self.message)

class InstrumentManager:
    def __init__(self):
        self.instruments: Dict[str, int] = {}
        self.last_update = None
        self.zerodha_client = None
        
    def set_zerodha_client(self, client):
        """Set the Zerodha client reference"""
        self.zerodha_client = client
        
    async def update_instruments_daily(self):
        """Update instrument master at 8:30 AM daily"""
        if (not self.last_update or 
            self.last_update.date() < datetime.now().date()):
            
            try:
                logger.info("Updating instruments master...")
                instruments_data = await self.zerodha_client.get_instruments()
                
                self.instruments = {}
                for inst in instruments_data:
                    key = f"{inst['exchange']}:{inst['symbol']}"
                    self.instruments[key] = inst['token']
                
                self.last_update = datetime.now()
                logger.info(f"Updated {len(self.instruments)} instruments")
                
            except Exception as e:
                logger.error(f"Failed to update instruments: {e}")
                raise TradingBotException(f"Instrument update failed: {e}", "INSTRUMENT_UPDATE_FAILED")
            
    def get_instrument_token(self, symbol: str, exchange: str = "NSE") -> int:
        """Get instrument token for a symbol"""
        key = f"{exchange}:{symbol}"
        if key not in self.instruments:
            # Try without exchange prefix
            alt_key = symbol
            if alt_key in self.instruments:
                return self.instruments[alt_key]
            raise TradingBotException(f"Instrument not found: {key}", "INSTRUMENT_NOT_FOUND")
        return self.instruments[key]
    
    def get_all_nifty50_tokens(self) -> List[int]:
        """Get all NIFTY 50 instrument tokens"""
        nifty50_symbols = [
            'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'HINDUNILVR', 'ICICIBANK', 'HDFC', 'SBIN', 
            'BHARTIARTL', 'KOTAKBANK', 'BAJFINANCE', 'LT', 'ITC', 'ASIANPAINT', 'AXISBANK', 
            'DMART', 'SUNPHARMA', 'ULTRACEMCO', 'TITAN', 'NESTLEIND', 'WIPRO', 'MARUTI', 
            'M&M', 'HCLTECH', 'NTPC', 'TATAMOTORS', 'POWERGRID', 'ONGC', 'JSWSTEEL', 'GRASIM',
            'TATASTEEL', 'TECHM', 'INDUSINDBK', 'HINDALCO', 'DIVISLAB', 'DRREDDY', 'BAJAJFINSV',
            'CIPLA', 'BPCL', 'BRITANNIA', 'SBILIFE', 'EICHERMOT', 'UPL', 'COALINDIA', 'SHREECEM',
            'BAJAJ-AUTO', 'HEROMOTOCO', 'TATACONSUM', 'ADANIPORTS', 'APOLLOHOSP'
        ]
        
        tokens = []
        for symbol in nifty50_symbols:
            try:
                token = self.get_instrument_token(symbol)
                tokens.append(token)
            except TradingBotException:
                logger.warning(f"Could not find token for {symbol}")
                
        return tokens
    
    def get_all_banknifty_tokens(self) -> List[int]:
        """Get all Bank NIFTY instrument tokens"""
        banknifty_symbols = [
            'HDFCBANK', 'ICICIBANK', 'KOTAKBANK', 'AXISBANK', 'SBIN', 'INDUSINDBK',
            'BANDHANBNK', 'FEDERALBNK', 'IDFCFIRSTB', 'PNB', 'BANKBARODA', 'AUBANK'
        ]
        
        tokens = []
        for symbol in banknifty_symbols:
            try:
                token = self.get_instrument_token(symbol)
                tokens.append(token)
            except TradingBotException:
                logger.warning(f"Could not find token for {symbol}")
                
        return tokens