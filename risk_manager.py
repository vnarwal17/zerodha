import logging
from typing import Dict, Any
from datetime import datetime, time, timezone, timedelta

logger = logging.getLogger(__name__)

class TradingBotException(Exception):
    def __init__(self, message: str, error_code: str, status_code: int = 400):
        self.message = message
        self.error_code = error_code
        self.status_code = status_code
        super().__init__(self.message)

class RiskManager:
    def __init__(self, max_position_size: float = 100000, max_daily_loss: float = 10000):
        self.max_position_size = max_position_size
        self.max_daily_loss = max_daily_loss
        self.daily_pnl = 0
        self.positions_count = 0
        self.max_positions = 5  # Maximum concurrent positions
        
    async def validate_order_risk(self, order_params: Dict[str, Any], zerodha_client) -> bool:
        """Validate order against risk management rules"""
        
        # Check daily loss limit
        if self.daily_pnl <= -self.max_daily_loss:
            raise TradingBotException("Daily loss limit exceeded", "RISK_LIMIT")
            
        # Check position size
        order_value = order_params['quantity'] * order_params.get('price', 0)
        if order_value > self.max_position_size:
            raise TradingBotException("Position size exceeds limit", "POSITION_LIMIT")
            
        # Check maximum concurrent positions
        if self.positions_count >= self.max_positions:
            raise TradingBotException("Maximum positions limit reached", "MAX_POSITIONS")
            
        # Check margin availability
        try:
            margins = await zerodha_client.get_margins()
            available_margin = margins.get('equity', {}).get('available', {}).get('live_balance', 0)
            if order_value > available_margin:
                raise TradingBotException("Insufficient margin", "MARGIN_INSUFFICIENT")
        except Exception as e:
            logger.warning(f"Could not check margins: {e}")
            
        return True
        
    async def implement_stop_loss_gtt(self, zerodha_client, symbol: str, quantity: int, stop_price: float) -> str:
        """Implement stop-loss using GTT orders for reliability"""
        try:
            gtt_params = {
                "type": "single",
                "condition": {
                    "tradingsymbol": symbol,
                    "trigger_values": [stop_price],
                    "exchange": "NSE"
                },
                "orders": [{
                    "transaction_type": "SELL",
                    "quantity": quantity,
                    "product": "CNC",  # GTT only supports CNC/NRML
                    "order_type": "MARKET"
                }]
            }
            
            # This would require implementing GTT in zerodha_client
            # return await zerodha_client.place_gtt(gtt_params)
            logger.info(f"GTT stop-loss would be placed for {symbol} at {stop_price}")
            return "GTT_PENDING"
            
        except Exception as e:
            logger.error(f"GTT placement error: {e}")
            raise TradingBotException(f"GTT placement failed: {e}", "GTT_FAILED")
    
    def update_pnl(self, pnl_change: float):
        """Update daily P&L"""
        self.daily_pnl += pnl_change
        
    def add_position(self):
        """Increment position count"""
        self.positions_count += 1
        
    def remove_position(self):
        """Decrement position count"""
        self.positions_count = max(0, self.positions_count - 1)
        
    def reset_daily_stats(self):
        """Reset daily statistics at market open"""
        self.daily_pnl = 0
        # Don't reset positions_count as positions can carry over