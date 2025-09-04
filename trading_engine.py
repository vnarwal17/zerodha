import asyncio
import logging
from datetime import datetime, time, timedelta
from typing import Dict, List, Optional, Any
import pandas as pd
import numpy as np
from models import *
from zerodha_client import ZerodhaClient

logger = logging.getLogger(__name__)

class TradingEngine:
    def __init__(self, zerodha_client: ZerodhaClient):
        self.zerodha = zerodha_client
        self.is_running = False
        self.strategy_states: Dict[str, StrategyState] = {}
        self.positions: List[Position] = []
        self.logs: List[StrategyLog] = []
        self.settings = TradingSettings()
        
        # Strategy parameters
        self.CANDLE_INTERVAL = "3minute"
        self.SMA_PERIOD = 50
        self.SETUP_TIME = time(10, 0)  # 10:00 AM
        self.ENTRY_OFFSET = 0.10
        self.SL_OFFSET = 0.15
        self.RISK_REWARD_RATIO = 5
        self.MIN_WICK_PERCENT = 15
        self.SKIP_CANDLES = 2
        self.ENTRY_CUTOFF = time(13, 0)  # 1:00 PM
        self.FORCE_EXIT_TIME = time(15, 0)  # 3:00 PM
    
    async def start_trading(self, symbols: List[TradingSymbol]):
        """Start live trading for given symbols"""
        self.is_running = True
        
        # Initialize strategy states
        for symbol in symbols:
            self.strategy_states[symbol.symbol] = StrategyState(
                symbol=symbol.symbol,
                last_update=datetime.now()
            )
        
        self._log("SYSTEM", "Trading started", f"Monitoring {len(symbols)} symbols")
        
        # Start the main trading loop
        asyncio.create_task(self._trading_loop())
    
    async def stop_trading(self):
        """Stop live trading"""
        self.is_running = False
        self._log("SYSTEM", "Trading stopped", "All monitoring stopped")
    
    async def _trading_loop(self):
        """Main trading loop"""
        while self.is_running:
            try:
                current_time = datetime.now().time()
                
                # Only trade during market hours (9:15 AM to 3:30 PM)
                if time(9, 15) <= current_time <= time(15, 30):
                    await self._process_all_symbols()
                
                # Check for force exit at 3:00 PM
                if current_time >= self.FORCE_EXIT_TIME:
                    await self._force_exit_all_positions()
                
                # Wait before next iteration (3 minutes for candle close)
                await asyncio.sleep(180)  # 3 minutes
                
            except Exception as e:
                logger.error(f"Trading loop error: {e}")
                await asyncio.sleep(60)  # Wait 1 minute on error
    
    async def _process_all_symbols(self):
        """Process all symbols for strategy signals"""
        for symbol, state in self.strategy_states.items():
            try:
                await self._process_symbol_strategy(symbol, state)
            except Exception as e:
                logger.error(f"Error processing {symbol}: {e}")
    
    async def _process_symbol_strategy(self, symbol: str, state: StrategyState):
        """Process strategy logic for a single symbol"""
        current_time = datetime.now().time()
        
        # Skip if trade already completed for the day
        if state.trade_completed:
            return
        
        # Get latest candle data
        candles = await self._get_candle_data(symbol)
        if len(candles) < self.SMA_PERIOD + 1:
            return
        
        latest_candle = candles[-1]
        
        # Calculate SMA
        sma_value = self._calculate_sma(candles, self.SMA_PERIOD)
        
        # Check for 10 AM setup
        if current_time >= self.SETUP_TIME and state.bias is None:
            await self._check_setup(symbol, state, latest_candle, sma_value)
        
        # Check for rejection candle
        elif state.bias and not state.rejection_candle:
            await self._check_rejection(symbol, state, latest_candle, sma_value)
        
        # Handle skip period
        elif state.rejection_candle and state.skip_candles_remaining > 0:
            state.skip_candles_remaining -= 1
            if state.skip_candles_remaining == 0:
                self._log(symbol, "SKIP_COMPLETE", "Skip period completed, ready for entry")
        
        # Check for entry
        elif state.rejection_candle and state.skip_candles_remaining == 0 and not state.is_position_active:
            if current_time <= self.ENTRY_CUTOFF:
                await self._check_entry(symbol, state, latest_candle)
        
        # Monitor position
        if state.is_position_active:
            await self._monitor_position(symbol, state, latest_candle)
        
        state.last_update = datetime.now()
    
    async def _check_setup(self, symbol: str, state: StrategyState, candle: CandleData, sma_value: float):
        """Check for valid 10 AM setup"""
        # Check if entire candle is above SMA (Long setup)
        if candle.low > sma_value:
            state.bias = "long"
            state.setup_candle = candle
            self._log(symbol, "SETUP_LONG", f"Valid long setup detected. Candle: {candle.low:.2f}-{candle.high:.2f}, SMA: {sma_value:.2f}")
        
        # Check if entire candle is below SMA (Short setup)
        elif candle.high < sma_value:
            state.bias = "short"
            state.setup_candle = candle
            self._log(symbol, "SETUP_SHORT", f"Valid short setup detected. Candle: {candle.low:.2f}-{candle.high:.2f}, SMA: {sma_value:.2f}")
        
        # Invalid setup - candle touches SMA
        else:
            state.trade_completed = True
            self._log(symbol, "SETUP_INVALID", f"Setup invalid - candle touches SMA. Skipping day.")
    
    async def _check_rejection(self, symbol: str, state: StrategyState, candle: CandleData, sma_value: float):
        """Check for valid rejection candle"""
        candle_range = candle.high - candle.low
        
        if state.bias == "long":
            # Lower wick touches SMA, body stays above
            lower_wick = candle.low
            wick_percent = (min(candle.open, candle.close) - candle.low) / candle_range * 100
            
            if (lower_wick <= sma_value <= min(candle.open, candle.close) and 
                max(candle.open, candle.close) > sma_value and
                wick_percent >= self.MIN_WICK_PERCENT):
                
                state.rejection_candle = candle
                state.skip_candles_remaining = self.SKIP_CANDLES
                self._log(symbol, "REJECTION_LONG", f"Long rejection candle confirmed. Wick: {wick_percent:.1f}%")
        
        elif state.bias == "short":
            # Upper wick touches SMA, body stays below
            upper_wick = candle.high
            wick_percent = (candle.high - max(candle.open, candle.close)) / candle_range * 100
            
            if (max(candle.open, candle.close) <= sma_value <= upper_wick and 
                min(candle.open, candle.close) < sma_value and
                wick_percent >= self.MIN_WICK_PERCENT):
                
                state.rejection_candle = candle
                state.skip_candles_remaining = self.SKIP_CANDLES
                self._log(symbol, "REJECTION_SHORT", f"Short rejection candle confirmed. Wick: {wick_percent:.1f}%")
        
        # Check if SMA is crossed - invalidate day
        if ((state.bias == "long" and candle.low < sma_value) or 
            (state.bias == "short" and candle.high > sma_value)):
            state.trade_completed = True
            self._log(symbol, "SMA_CROSSED", "SMA crossed after setup. Day invalidated.")
    
    async def _check_entry(self, symbol: str, state: StrategyState, candle: CandleData):
        """Check for entry trigger"""
        if not state.rejection_candle:
            return
        
        if state.bias == "long":
            entry_price = state.rejection_candle.high + self.ENTRY_OFFSET
            stop_loss = state.rejection_candle.low - self.SL_OFFSET
            
            if candle.high >= entry_price:
                await self._enter_position(symbol, state, "long", entry_price, stop_loss)
        
        elif state.bias == "short":
            entry_price = state.rejection_candle.low - self.ENTRY_OFFSET
            stop_loss = state.rejection_candle.high + self.SL_OFFSET
            
            if candle.low <= entry_price:
                await self._enter_position(symbol, state, "short", entry_price, stop_loss)
    
    async def _enter_position(self, symbol: str, state: StrategyState, direction: str, entry_price: float, stop_loss: float):
        """Enter a trading position"""
        # Calculate target
        risk = abs(entry_price - stop_loss)
        target = entry_price + (risk * self.RISK_REWARD_RATIO) if direction == "long" else entry_price - (risk * self.RISK_REWARD_RATIO)
        
        # Calculate quantity based on position sizing
        quantity = self._calculate_quantity(entry_price, stop_loss)
        
        if not self.settings.dry_run:
            # Place actual order
            order_result = await self.zerodha.place_order(
                symbol=symbol,
                transaction_type="BUY" if direction == "long" else "SELL",
                quantity=quantity,
                price=entry_price
            )
            
            if order_result['status'] != 'success':
                self._log(symbol, "ORDER_FAILED", f"Order placement failed: {order_result.get('message')}")
                return
        
        # Create position
        position = Position(
            id=f"{symbol}_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            symbol=symbol,
            direction=direction,
            entry_price=entry_price,
            current_price=entry_price,
            stop_loss=stop_loss,
            target=target,
            quantity=quantity,
            status="ACTIVE",
            unrealized_pnl=0.0,
            entry_time=datetime.now().isoformat()
        )
        
        self.positions.append(position)
        state.is_position_active = True
        state.entry_price = entry_price
        state.stop_loss = stop_loss
        state.target = target
        
        self._log(symbol, "POSITION_ENTERED", 
                 f"{direction.upper()} @ {entry_price:.2f}, SL: {stop_loss:.2f}, Target: {target:.2f}, Qty: {quantity}")
    
    async def _monitor_position(self, symbol: str, state: StrategyState, candle: CandleData):
        """Monitor active position for exit conditions"""
        # Find the active position
        position = next((p for p in self.positions if p.symbol == symbol and p.status == "ACTIVE"), None)
        if not position:
            return
        
        # Update current price
        position.current_price = candle.close
        
        # Calculate unrealized P&L
        if position.direction == "long":
            position.unrealized_pnl = (candle.close - position.entry_price) * position.quantity
        else:
            position.unrealized_pnl = (position.entry_price - candle.close) * position.quantity
        
        # Check for stop loss
        if ((position.direction == "long" and candle.low <= position.stop_loss) or
            (position.direction == "short" and candle.high >= position.stop_loss)):
            await self._exit_position(position, position.stop_loss, "STOP_LOSS")
            state.trade_completed = True
        
        # Check for target
        elif ((position.direction == "long" and candle.high >= position.target) or
              (position.direction == "short" and candle.low <= position.target)):
            await self._exit_position(position, position.target, "TARGET")
            state.trade_completed = True
    
    async def _exit_position(self, position: Position, exit_price: float, reason: str):
        """Exit a position"""
        if not self.settings.dry_run:
            # Place exit order
            await self.zerodha.place_order(
                symbol=position.symbol,
                transaction_type="SELL" if position.direction == "long" else "BUY",
                quantity=position.quantity
            )
        
        # Update position
        position.status = "CLOSED"
        position.current_price = exit_price
        position.exit_time = datetime.now().isoformat()
        position.exit_reason = reason
        
        # Calculate final P&L
        if position.direction == "long":
            position.unrealized_pnl = (exit_price - position.entry_price) * position.quantity
        else:
            position.unrealized_pnl = (position.entry_price - exit_price) * position.quantity
        
        self._log(position.symbol, "POSITION_CLOSED", 
                 f"Position closed @ {exit_price:.2f} ({reason}). P&L: ₹{position.unrealized_pnl:.2f}")
    
    async def _force_exit_all_positions(self):
        """Force exit all positions at market close"""
        active_positions = [p for p in self.positions if p.status == "ACTIVE"]
        for position in active_positions:
            await self._exit_position(position, position.current_price, "FORCE_EXIT")
            # Mark state as completed
            if position.symbol in self.strategy_states:
                self.strategy_states[position.symbol].trade_completed = True
    
    def _calculate_quantity(self, entry_price: float, stop_loss: float) -> int:
        """Calculate position quantity based on settings"""
        if self.settings.position_sizing == "fixed_capital":
            # Fixed capital per trade
            quantity = int(self.settings.fixed_capital_per_trade / entry_price)
        else:
            # Fixed risk percentage
            risk_per_share = abs(entry_price - stop_loss)
            total_capital = self.settings.fixed_capital_per_trade * 50  # Assume total capital
            risk_amount = total_capital * (self.settings.risk_percent / 100)
            quantity = int(risk_amount / risk_per_share)
        
        # Apply leverage
        quantity = int(quantity * self.settings.leverage)
        
        return max(1, quantity)  # Minimum 1 share
    
    async def _get_candle_data(self, symbol: str) -> List[CandleData]:
        """Get latest candle data for symbol"""
        # This would typically fetch from Zerodha API
        # For now, return mock data
        from_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        to_date = datetime.now().strftime("%Y-%m-%d")
        
        # Mock implementation - replace with actual API call
        candles = []
        base_price = 100.0
        for i in range(self.SMA_PERIOD + 10):
            timestamp = datetime.now() - timedelta(minutes=(self.SMA_PERIOD + 10 - i) * 3)
            open_price = base_price + np.random.uniform(-2, 2)
            close_price = open_price + np.random.uniform(-1, 1)
            high_price = max(open_price, close_price) + np.random.uniform(0, 1)
            low_price = min(open_price, close_price) - np.random.uniform(0, 1)
            
            candles.append(CandleData(
                timestamp=timestamp,
                open=open_price,
                high=high_price,
                low=low_price,
                close=close_price,
                volume=10000
            ))
        
        return candles
    
    def _calculate_sma(self, candles: List[CandleData], period: int) -> float:
        """Calculate Simple Moving Average"""
        if len(candles) < period:
            return 0.0
        
        closes = [candle.close for candle in candles[-period:]]
        return sum(closes) / len(closes)
    
    def _log(self, symbol: str, event: str, message: str):
        """Add a log entry"""
        log_entry = StrategyLog(
            timestamp=datetime.now().isoformat(),
            symbol=symbol,
            event=event,
            message=message
        )
        self.logs.append(log_entry)
        logger.info(f"[{symbol}] {event}: {message}")
        
        # Keep only last 1000 logs
        if len(self.logs) > 1000:
            self.logs = self.logs[-1000:]
    
    async def get_live_status(self) -> LiveStatus:
        """Get current live trading status"""
        active_positions = [p for p in self.positions if p.status == "ACTIVE"]
        
        return LiveStatus(
            market_open=time(9, 15) <= datetime.now().time() <= time(15, 30),
            active_positions=len(active_positions),
            total_positions=len(self.positions),
            monitoring_symbols=len(self.strategy_states),
            positions_detail=active_positions,
            strategy_logs=self.logs[-50:]  # Last 50 logs
        )
    
    async def update_settings(self, settings: Dict[str, Any]):
        """Update trading settings"""
        for key, value in settings.items():
            if hasattr(self.settings, key):
                setattr(self.settings, key, value)
        
        self._log("SYSTEM", "SETTINGS_UPDATED", f"Settings updated: {settings}")