from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime

class LoginRequest(BaseModel):
    request_token: Optional[str] = None

class TradingSymbol(BaseModel):
    symbol: str
    name: str
    token: int
    exchange: str
    is_nifty50: bool = False
    is_banknifty: bool = False

class StartTradingRequest(BaseModel):
    symbols: List[TradingSymbol]

class TradingSettings(BaseModel):
    dry_run: bool = True
    fixed_capital_per_trade: float = 100000
    risk_percent: float = 1.0
    leverage: float = 1.0
    position_sizing: Literal["fixed_capital", "fixed_risk"] = "fixed_capital"

class ExportRequest(BaseModel):
    trades: List[Dict[str, Any]]

class ApiResponse(BaseModel):
    status: Literal["success", "error", "info", "requires_login", "connected", "disconnected"]
    message: Optional[str] = None
    data: Optional[Dict[str, Any]] = None

class Position(BaseModel):
    id: str
    symbol: str
    direction: Literal["long", "short"]
    entry_price: float
    current_price: float
    stop_loss: float
    target: float
    quantity: int
    status: str
    unrealized_pnl: float
    entry_time: str
    exit_time: Optional[str] = None
    exit_reason: Optional[str] = None

class StrategyLog(BaseModel):
    timestamp: str
    symbol: str
    event: str
    message: str

class LiveStatus(BaseModel):
    market_open: bool
    active_positions: int
    total_positions: int
    monitoring_symbols: int
    positions_detail: List[Position] = []
    strategy_logs: List[StrategyLog] = []

class CandleData(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int

class StrategyState(BaseModel):
    symbol: str
    bias: Optional[Literal["long", "short"]] = None
    setup_candle: Optional[CandleData] = None
    rejection_candle: Optional[CandleData] = None
    skip_candles_remaining: int = 0
    entry_price: Optional[float] = None
    stop_loss: Optional[float] = None
    target: Optional[float] = None
    is_position_active: bool = False
    trade_completed: bool = False
    last_update: datetime