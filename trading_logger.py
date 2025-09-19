import logging
import os
from datetime import datetime
from typing import Any, Dict

class TradingLogger:
    def __init__(self, name: str = 'TradingBot'):
        self.logger = logging.getLogger(name)
        self._setup_logging()
        
    def _setup_logging(self):
        """Configure comprehensive logging"""
        # Create logs directory if it doesn't exist
        log_dir = 'logs'
        if not os.path.exists(log_dir):
            os.makedirs(log_dir)
            
        # Configure logging format
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        
        # File handler for daily logs
        log_filename = f"{log_dir}/trading_bot_{datetime.now().strftime('%Y%m%d')}.log"
        file_handler = logging.FileHandler(log_filename)
        file_handler.setFormatter(formatter)
        file_handler.setLevel(logging.DEBUG)
        
        # Console handler
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(formatter)
        console_handler.setLevel(logging.INFO)
        
        # Configure logger
        self.logger.setLevel(logging.DEBUG)
        self.logger.addHandler(file_handler)
        self.logger.addHandler(console_handler)
        
        # Prevent duplicate logs
        self.logger.propagate = False
        
    def log_trade_action(self, symbol: str, action: str, details: Dict[str, Any]):
        """Log trading actions with structured data"""
        self.logger.info(f"TRADE: {symbol} - {action} - {details}")
        
    def log_api_call(self, endpoint: str, params: Dict[str, Any], response: Dict[str, Any]):
        """Log API calls for debugging"""
        self.logger.debug(f"API: {endpoint} - Params: {params} - Response: {response}")
        
    def log_error(self, error_type: str, message: str, context: Dict[str, Any]):
        """Log errors with context"""
        self.logger.error(f"ERROR: {error_type} - {message} - Context: {context}")
        
    def log_strategy_event(self, symbol: str, event: str, data: Dict[str, Any]):
        """Log strategy-specific events"""
        self.logger.info(f"STRATEGY: {symbol} - {event} - {data}")
        
    def log_risk_event(self, event: str, data: Dict[str, Any]):
        """Log risk management events"""
        self.logger.warning(f"RISK: {event} - {data}")
        
    def log_system_event(self, event: str, data: Dict[str, Any]):
        """Log system events"""
        self.logger.info(f"SYSTEM: {event} - {data}")
        
    def log_order_event(self, symbol: str, order_type: str, order_data: Dict[str, Any]):
        """Log order placement and management events"""
        self.logger.info(f"ORDER: {symbol} - {order_type} - {order_data}")
        
    def log_position_event(self, symbol: str, position_action: str, position_data: Dict[str, Any]):
        """Log position management events"""
        self.logger.info(f"POSITION: {symbol} - {position_action} - {position_data}")
        
    def log_session_event(self, event: str, data: Dict[str, Any]):
        """Log session and authentication events"""
        self.logger.info(f"SESSION: {event} - {data}")

# Global logger instance
trading_logger = TradingLogger()