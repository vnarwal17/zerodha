import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

class TradingConfig:
    def __init__(self):
        # Core API credentials
        self.API_KEY = os.getenv('ZERODHA_API_KEY', 'graf84f2wec04nbl')
        self.API_SECRET = os.getenv('ZERODHA_API_SECRET', 'rcaxwf44jd6en5yujwzgmm36hbwbffz6')
        
        # Risk management
        self.MAX_POSITION_SIZE = int(os.getenv('MAX_POSITION_SIZE', '100000'))
        self.MAX_DAILY_LOSS = int(os.getenv('MAX_DAILY_LOSS', '10000'))
        self.MAX_POSITIONS = int(os.getenv('MAX_POSITIONS', '5'))
        
        # Trading parameters
        self.DRY_RUN = os.getenv('DRY_RUN', 'true').lower() == 'true'
        self.LEVERAGE = float(os.getenv('LEVERAGE', '1.0'))
        self.RISK_PERCENT = float(os.getenv('RISK_PERCENT', '2.0'))
        
        # Strategy parameters
        self.CANDLE_INTERVAL = os.getenv('CANDLE_INTERVAL', '3minute')
        self.SMA_PERIOD = int(os.getenv('SMA_PERIOD', '50'))
        self.ENTRY_OFFSET = float(os.getenv('ENTRY_OFFSET', '0.01'))
        self.SL_OFFSET = float(os.getenv('SL_OFFSET', '0.01'))
        self.RISK_REWARD_RATIO = float(os.getenv('RISK_REWARD_RATIO', '5'))
        self.MIN_WICK_PERCENT = float(os.getenv('MIN_WICK_PERCENT', '15'))
        self.SKIP_CANDLES = int(os.getenv('SKIP_CANDLES', '2'))
        
        # Market timing
        self.MARKET_OPEN_HOUR = int(os.getenv('MARKET_OPEN_HOUR', '9'))
        self.MARKET_OPEN_MINUTE = int(os.getenv('MARKET_OPEN_MINUTE', '15'))
        self.MARKET_CLOSE_HOUR = int(os.getenv('MARKET_CLOSE_HOUR', '15'))
        self.MARKET_CLOSE_MINUTE = int(os.getenv('MARKET_CLOSE_MINUTE', '30'))
        self.FORCE_EXIT_HOUR = int(os.getenv('FORCE_EXIT_HOUR', '15'))
        self.FORCE_EXIT_MINUTE = int(os.getenv('FORCE_EXIT_MINUTE', '0'))
        self.ENTRY_CUTOFF_HOUR = int(os.getenv('ENTRY_CUTOFF_HOUR', '13'))
        self.ENTRY_CUTOFF_MINUTE = int(os.getenv('ENTRY_CUTOFF_MINUTE', '0'))
        
        # Logging
        self.LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
        self.LOG_FILE_ENABLED = os.getenv('LOG_FILE_ENABLED', 'true').lower() == 'true'
        
        # Validate required configs
        if not self.API_KEY or not self.API_SECRET:
            raise ValueError("ZERODHA_API_KEY and ZERODHA_API_SECRET must be set")
        
        logger.info(f"Trading configuration loaded - DRY_RUN: {self.DRY_RUN}")

# NSE Holiday Calendar 2025
NSE_HOLIDAYS_2025 = [
    "2025-01-26",  # Republic Day
    "2025-03-14",  # Holi
    "2025-04-18",  # Good Friday
    "2025-04-21",  # Ram Navami
    "2025-05-01",  # Maharashtra Day
    "2025-06-15",  # Eid al-Adha
    "2025-08-15",  # Independence Day
    "2025-08-16",  # Parsi New Year
    "2025-09-07",  # Ganesh Chaturthi
    "2025-10-02",  # Gandhi Jayanti
    "2025-10-21",  # Dussehra
    "2025-11-01",  # Diwali Laxmi Pujan
    "2025-11-02",  # Diwali Balipratipada
    "2025-11-05",  # Bhai Dooj
    "2025-11-24",  # Guru Nanak Jayanti
    "2025-12-25"   # Christmas
]

def is_market_holiday(date):
    """Check if given date is NSE market holiday"""
    date_str = date.strftime("%Y-%m-%d")
    return date_str in NSE_HOLIDAYS_2025
    
    def get_market_hours(self):
        """Get market hours configuration"""
        return {
            'open': f"{self.MARKET_OPEN_HOUR:02d}:{self.MARKET_OPEN_MINUTE:02d}",
            'close': f"{self.MARKET_CLOSE_HOUR:02d}:{self.MARKET_CLOSE_MINUTE:02d}",
            'force_exit': f"{self.FORCE_EXIT_HOUR:02d}:{self.FORCE_EXIT_MINUTE:02d}",
            'entry_cutoff': f"{self.ENTRY_CUTOFF_HOUR:02d}:{self.ENTRY_CUTOFF_MINUTE:02d}"
        }
    
    def to_dict(self):
        """Convert configuration to dictionary"""
        return {
            'api_key': self.API_KEY[:8] + '...',  # Masked for security
            'max_position_size': self.MAX_POSITION_SIZE,
            'max_daily_loss': self.MAX_DAILY_LOSS,
            'max_positions': self.MAX_POSITIONS,
            'dry_run': self.DRY_RUN,
            'leverage': self.LEVERAGE,
            'risk_percent': self.RISK_PERCENT,
            'strategy': {
                'candle_interval': self.CANDLE_INTERVAL,
                'sma_period': self.SMA_PERIOD,
                'entry_offset': self.ENTRY_OFFSET,
                'sl_offset': self.SL_OFFSET,
                'risk_reward_ratio': self.RISK_REWARD_RATIO,
                'min_wick_percent': self.MIN_WICK_PERCENT,
                'skip_candles': self.SKIP_CANDLES
            },
            'market_hours': self.get_market_hours()
        }