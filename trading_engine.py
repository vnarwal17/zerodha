import asyncio
import logging
from datetime import datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Any
import pandas as pd
import numpy as np
from models import *
from zerodha_client import ZerodhaClient
from enhanced_error_handler import EnhancedErrorHandler
from risk_manager import RiskManager
from instrument_manager import InstrumentManager
from trading_config import TradingConfig
from trading_logger import trading_logger
from websocket_manager import WebSocketManager
from connection_monitor import ConnectionMonitor

logger = logging.getLogger(__name__)

class ImprovedTradingEngine:
    def __init__(self, zerodha_client: ZerodhaClient):
        self.zerodha = zerodha_client
        self.is_running = False
        self.strategy_states: Dict[str, StrategyState] = {}
        self.positions: List[Position] = []
        self.logs: List[StrategyLog] = []
        self.settings = TradingSettings()
        
        # Initialize components
        self.config = TradingConfig()
        self.error_handler = EnhancedErrorHandler(zerodha_client)
        self.risk_manager = RiskManager(
            max_position_size=self.config.MAX_POSITION_SIZE,
            max_daily_loss=self.config.MAX_DAILY_LOSS
        )
        self.instrument_manager = InstrumentManager()
        self.instrument_manager.set_zerodha_client(zerodha_client)
        
        # WebSocket for real-time data
        self.websocket_manager = None
        self.current_prices: Dict[str, float] = {}
        self.connection_monitor = None
        
        # Market timing
        self.MARKET_OPEN = time(self.config.MARKET_OPEN_HOUR, self.config.MARKET_OPEN_MINUTE)
        self.MARKET_CLOSE = time(self.config.MARKET_CLOSE_HOUR, self.config.MARKET_CLOSE_MINUTE)
        self.FORCE_EXIT_TIME = time(self.config.FORCE_EXIT_HOUR, self.config.FORCE_EXIT_MINUTE)
        self.AUTO_SQUAREOFF_EQUITY = time(15, 20)  # MIS equity auto square-off
        self.ENTRY_CUTOFF = time(self.config.ENTRY_CUTOFF_HOUR, self.config.ENTRY_CUTOFF_MINUTE)
        
        # Strategy parameters from config
        self.CANDLE_INTERVAL = self.config.CANDLE_INTERVAL
        self.SMA_PERIOD = self.config.SMA_PERIOD
        self.SETUP_TIME = time(10, 0)  # 10:00 AM
        self.ENTRY_OFFSET = self.config.ENTRY_OFFSET
        self.SL_OFFSET = self.config.SL_OFFSET
        self.RISK_REWARD_RATIO = self.config.RISK_REWARD_RATIO
        self.MIN_WICK_PERCENT = self.config.MIN_WICK_PERCENT
        self.SKIP_CANDLES = self.config.SKIP_CANDLES
    
    def is_market_open(self):
        """Check if market is currently open"""
        now = datetime.now(timezone(timedelta(hours=5, minutes=30)))  # IST
        current_time = now.time()
        is_weekday = now.weekday() < 5
        is_holiday = self.is_market_holiday(now.date())
        
        return (self.MARKET_OPEN <= current_time <= self.MARKET_CLOSE and 
                is_weekday and not is_holiday)
    
    def is_market_holiday(self, date):
        """Check if given date is a market holiday (basic implementation)"""
        # This should be enhanced with actual NSE holiday calendar
        return False

    async def setup_websocket_streaming(self, symbols: List[str]):
        """Setup WebSocket streaming for real-time data"""
        try:
            if not self.zerodha.access_token:
                raise TradingBotException("No access token for WebSocket", "NO_TOKEN")
                
            self.websocket_manager = WebSocketManager(
                self.zerodha.api_key, 
                self.zerodha.access_token
            )
            
            # Get instrument tokens for symbols
            tokens = []
            for symbol in symbols:
                try:
                    token = self.instrument_manager.get_instrument_token(symbol)
                    tokens.append(token)
                except Exception as e:
                    logger.warning(f"Could not get token for {symbol}: {e}")
                    
            # Set up tick callback
            self.websocket_manager.set_tick_callback(self.process_tick_data)
            
            # Connect and subscribe
            await self.websocket_manager.connect()
            await asyncio.sleep(2)  # Allow connection to establish
            self.websocket_manager.subscribe(tokens)
            
            logger.info(f"WebSocket streaming setup for {len(tokens)} symbols")
            
        except Exception as e:
            logger.error(f"WebSocket setup error: {e}")
            raise

    def process_tick_data(self, tick):
        """Process incoming tick data for strategy signals"""
        try:
            instrument_token = tick['instrument_token']
            last_price = tick['last_price']
            
            # Find symbol for this token
            symbol = self.get_symbol_from_token(instrument_token)
            if not symbol:
                return
                
            # Update current price
            self.current_prices[symbol] = last_price
            
            # Check if this symbol has an active strategy
            if symbol in self.strategy_states:
                # Create candle data from tick (simplified)
                candle_data = self.create_candle_from_tick(tick)
                
                # Process strategy for this symbol
                asyncio.create_task(
                    self._process_symbol_strategy(symbol, self.strategy_states[symbol])
                )
                
        except Exception as e:
            logger.error(f"Tick processing error: {e}")

    def get_symbol_from_token(self, instrument_token: int) -> Optional[str]:
        """Get symbol name from instrument token"""
        for symbol, state in self.strategy_states.items():
            try:
                if self.instrument_manager.get_instrument_token(symbol) == instrument_token:
                    return symbol
            except:
                continue
        return None

    def create_candle_from_tick(self, tick) -> CandleData:
        """Create candle data from tick (simplified for real-time processing)"""
        return CandleData(
            timestamp=datetime.now(),
            open=tick.get('ohlc', {}).get('open', tick['last_price']),
            high=tick.get('ohlc', {}).get('high', tick['last_price']),
            low=tick.get('ohlc', {}).get('low', tick['last_price']),
            close=tick['last_price'],
            volume=tick.get('volume', 0)
        )

    async def start_trading(self, symbols: List[TradingSymbol]):
        """Enhanced start trading with all safety features"""
        try:
            # Pre-flight checks
            if not self.is_market_open():
                raise TradingBotException("Market is closed", "MARKET_CLOSED")
                
            await self.zerodha.refresh_session_if_needed()
            await self.instrument_manager.update_instruments_daily()
            
            # Initialize connection monitoring
            self.connection_monitor = ConnectionMonitor(self.zerodha)
            
            # Start monitoring in background
            asyncio.create_task(self.connection_monitor.start_monitoring())
            
            # Setup WebSocket for real-time data
            symbol_names = [s.symbol for s in symbols]
            await self.setup_websocket_streaming(symbol_names)
            
            # Initialize strategy states
            for symbol in symbols:
                self.strategy_states[symbol.symbol] = StrategyState(
                    symbol=symbol.symbol,
                    last_update=datetime.now()
                )
            
            trading_logger.log_system_event("TRADING_STARTED", {
                "symbols_count": len(symbols),
                "symbols": [s.symbol for s in symbols],
                "config": self.config.to_dict()
            })
            
            self._log("SYSTEM", "Trading started", f"Monitoring {len(symbols)} symbols")
            
            # Start the main trading loop
            asyncio.create_task(self._trading_loop())
            
        except Exception as e:
            trading_logger.log_error("TRADING_START_ERROR", str(e), {"symbols": symbol_names})
            raise
    
    async def stop_trading(self):
        """Stop live trading"""
        self.is_running = False
        self._log("SYSTEM", "Trading stopped", "All monitoring stopped")
    
    async def _enhanced_trading_loop(self):
        """Enhanced trading loop with comprehensive error handling"""
        while self.is_running:
            try:
                current_time = datetime.now().time()
                
                # Check market hours
                if not self.is_market_open():
                    logger.info("Market closed, stopping trading")
                    break
                    
                # Check for force exit
                if current_time >= self.FORCE_EXIT_TIME:
                    await self._force_exit_all_positions()
                    break
                    
                # Process strategy for all symbols
                await self._process_all_symbols()
                
                # Brief pause to prevent excessive CPU usage
                await asyncio.sleep(1)
                
            except Exception as e:
                logger.error(f"Trading loop error: {e}")
                trading_logger.log_error("TRADING_LOOP_ERROR", str(e), {})
                await asyncio.sleep(30)  # Wait before retrying
                
        # Cleanup
        await self._cleanup_trading_session()

    async def _cleanup_trading_session(self):
        """Cleanup resources after trading session"""
        try:
            if self.connection_monitor:
                self.connection_monitor.stop_monitoring()
                
            if self.websocket_manager:
                self.websocket_manager.disconnect()
                
            trading_logger.log_system_event("TRADING_STOPPED", {
                "positions_count": len([p for p in self.positions if p.status == "ACTIVE"]),
                "total_pnl": sum(p.realized_pnl for p in self.positions)
            })
            
        except Exception as e:
            logger.error(f"Cleanup error: {e}")
    
    async def _process_all_symbols(self):
        """Process all symbols for strategy signals"""
        for symbol, state in self.strategy_states.items():
            try:
                await self._process_symbol_strategy(symbol, state)
            except Exception as e:
                logger.error(f"Error processing {symbol}: {e}")
    
    async def _process_symbol_strategy(self, symbol: str, state: StrategyState):
        """Process strategy logic for a single symbol"""
        try:
            current_time = datetime.now().time()
            
            # Skip if trade already completed for the day
            if state.trade_completed:
                return
            
            # Get latest candle data
            candles = await self._get_candle_data(symbol)
            if not candles or len(candles) < self.SMA_PERIOD + 1:
                self._log(symbol, "ERROR", "Insufficient candle data")
                return
        
        latest_candle = candles[-1]
        
        # Calculate SMA
        sma_value = self._calculate_sma(candles, self.SMA_PERIOD)
        
        # Check for 10 AM setup - more flexible timing check
        current_candle_time = latest_candle.timestamp.time()
        current_hour = current_candle_time.hour
        current_minute = current_candle_time.minute
        
        # Log current candle time for debugging
        self._log(symbol, "CANDLE_TIME", f"Processing candle at {current_candle_time.strftime('%H:%M:%S')}")
        
        # Check for 10 AM setup (accept any candle between 9:57-10:05 for setup)
        setup_window_start = time(9, 57)
        setup_window_end = time(10, 5)
        
        if (setup_window_start <= current_candle_time <= setup_window_end and 
            state.bias is None):
            self._log(symbol, "SETUP_CHECK", f"Checking setup for {current_candle_time.strftime('%H:%M:%S')} candle")
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
        except Exception as e:
            self._log(symbol, "ERROR", f"Strategy processing failed: {str(e)}")
            logger.error(f"Error processing {symbol}: {e}")
    
    async def _check_setup(self, symbol: str, state: StrategyState, candle: CandleData, sma_value: float):
        """Check for valid 10 AM setup"""
        setup_time = candle.timestamp.strftime("%I:%M %p")  # Format time as 10:00 AM
        
        self._log(symbol, "SETUP_ANALYSIS", f"Analyzing setup at {setup_time}: Candle {candle.low:.2f}-{candle.high:.2f}, SMA: {sma_value:.2f}")
        
        # Check if entire candle is above SMA (Long setup)
        if candle.low > sma_value:
            state.bias = "long"
            state.setup_candle = candle
            
            # Log setup detection in required format
            setup_message = f"Setup detected for {symbol}: BUY (10 AM candle closed above 50-SMA)"
            self._log_setup_detection(symbol, "BUY", setup_time, setup_message)
            self._log(symbol, "SETUP_LONG", f"Valid long setup detected. Candle: {candle.low:.2f}-{candle.high:.2f}, SMA: {sma_value:.2f}")
        
        # Check if entire candle is below SMA (Short setup)
        elif candle.high < sma_value:
            state.bias = "short"
            state.setup_candle = candle
            
            # Log setup detection in required format
            setup_message = f"Setup detected for {symbol}: SELL (10 AM candle closed below 50-SMA)"
            self._log_setup_detection(symbol, "SELL", setup_time, setup_message)
            self._log(symbol, "SETUP_SHORT", f"Valid short setup detected. Candle: {candle.low:.2f}-{candle.high:.2f}, SMA: {sma_value:.2f}")
        
        # Invalid setup - candle touches SMA
        else:
            state.trade_completed = True
            invalid_message = f"Setup rejected for {symbol}: INVALID (10 AM candle touched 50-SMA)"
            self._log_setup_detection(symbol, "INVALID", setup_time, invalid_message)
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
    
    async def place_order_with_validation(self, order_params: Dict[str, Any]) -> str:
        """Place order with comprehensive validation"""
        # Validate market hours
        if not self.is_market_open():
            raise TradingBotException("Market is closed", "MARKET_CLOSED")
            
        # Risk validation
        await self.risk_manager.validate_order_risk(order_params, self.zerodha)
        
        # Place order with error handling
        order_id = await self.error_handler.handle_api_call(
            self.zerodha.place_order, **order_params
        )
        
        # Verify execution
        await asyncio.sleep(1)  # Allow processing time
        order_status = await self.zerodha.verify_order_status(order_id)
        
        if order_status not in ['COMPLETE', 'OPEN']:
            raise TradingBotException(f"Order failed: {order_status}", "ORDER_FAILED")
            
        return order_id

    async def _enter_position(self, symbol: str, state: StrategyState, direction: str, entry_price: float, stop_loss: float):
        """Enter a trading position with enhanced validation"""
        try:
            # Calculate target
            risk = abs(entry_price - stop_loss)
            target = entry_price + (risk * self.RISK_REWARD_RATIO) if direction == "long" else entry_price - (risk * self.RISK_REWARD_RATIO)
            
            # Calculate quantity based on position sizing
            quantity = self._calculate_quantity(entry_price, stop_loss)
            
            # Prepare order parameters
            order_params = {
                'symbol': symbol,
                'transaction_type': "BUY" if direction == "long" else "SELL",
                'quantity': quantity,
                'price': entry_price
            }
            
            if not self.settings.dry_run:
                # Place actual order with validation
                order_result = await self.place_order_with_validation(order_params)
                
                trading_logger.log_order_event(symbol, "ENTRY_ORDER", {
                    "direction": direction,
                    "entry_price": entry_price,
                    "quantity": quantity,
                    "order_id": order_result.get('order_id'),
                    "status": order_result.get('status')
                })
                
                if order_result['status'] != 'success':
                    self._log(symbol, "ORDER_FAILED", f"Order placement failed: {order_result.get('message')}")
                    return
                
                self._log(symbol, "ORDER_PLACED", f"Order placed successfully: {order_result.get('order_id')}")
                
                # Implement GTT stop-loss for added protection
                await self.risk_manager.implement_stop_loss_gtt(self.zerodha, symbol, quantity, stop_loss)
                
            else:
                self._log(symbol, "DRY_RUN", f"DRY RUN: Would place {direction.upper()} order @ {entry_price:.2f}")
            
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
            self.risk_manager.add_position()
            state.is_position_active = True
            state.entry_price = entry_price
            state.stop_loss = stop_loss
            state.target = target
            
            trading_logger.log_position_event(symbol, "POSITION_ENTERED", {
                "direction": direction,
                "entry_price": entry_price,
                "stop_loss": stop_loss,
                "target": target,
                "quantity": quantity,
                "risk_amount": abs(entry_price - stop_loss) * quantity
            })
            
            self._log(symbol, "POSITION_ENTERED", 
                     f"{direction.upper()} @ {entry_price:.2f}, SL: {stop_loss:.2f}, Target: {target:.2f}, Qty: {quantity}")
                     
        except Exception as e:
            trading_logger.log_error("POSITION_ENTRY_ERROR", str(e), {
                "symbol": symbol,
                "direction": direction,
                "entry_price": entry_price,
                "stop_loss": stop_loss
            })
            raise
    
    async def _monitor_position(self, symbol: str, state: StrategyState, candle: CandleData):
        """Enhanced position monitoring with actual exit orders"""
        position = next((p for p in self.positions if p.symbol == symbol and p.status == "ACTIVE"), None)
        if not position:
            return
        
        # Update current price and P&L
        position.current_price = candle.close
        if position.direction == "long":
            position.unrealized_pnl = (candle.close - position.entry_price) * position.quantity
        else:
            position.unrealized_pnl = (position.entry_price - candle.close) * position.quantity
        
        # Check for stop loss hit
        stop_loss_hit = (
            (position.direction == "long" and candle.low <= position.stop_loss) or
            (position.direction == "short" and candle.high >= position.stop_loss)
        )
        
        # Check for target hit  
        target_hit = (
            (position.direction == "long" and candle.high >= position.target) or
            (position.direction == "short" and candle.low <= position.target)
        )
        
        # Execute exit if conditions met
        if stop_loss_hit:
            await self._exit_position(position, "STOP_LOSS", position.stop_loss)
        elif target_hit:
            await self._exit_position(position, "TARGET", position.target)
    
    async def _exit_position(self, position: Position, exit_reason: str, exit_price: float):
        """Execute position exit with actual order placement"""
        try:
            # Determine exit transaction type (opposite of entry)
            exit_transaction = "SELL" if position.direction == "long" else "BUY"
            
            # Place exit order
            exit_order_params = {
                'symbol': position.symbol,
                'transaction_type': exit_transaction,
                'quantity': position.quantity,
                'price': exit_price
            }
            
            if not self.settings.dry_run:
                # Place actual exit order
                exit_result = await self.place_order_with_validation(exit_order_params)
                
                if exit_result['status'] == 'success':
                    # Update position
                    position.status = "CLOSED"
                    position.exit_price = exit_price
                    position.realized_pnl = position.unrealized_pnl
                    position.exit_time = datetime.now().isoformat()
                    
                    # Update risk manager
                    self.risk_manager.update_pnl(position.realized_pnl)
                    self.risk_manager.remove_position()
                    
                    # Update strategy state
                    state = self.strategy_states[position.symbol]
                    state.is_position_active = False
                    state.trade_completed = True
                    
                    trading_logger.log_position_event(position.symbol, "POSITION_CLOSED", {
                        "exit_reason": exit_reason,
                        "exit_price": exit_price,
                        "realized_pnl": position.realized_pnl,
                        "order_id": exit_result.get('order_id')
                    })
                    
                    self._log(position.symbol, "POSITION_EXITED", 
                             f"{exit_reason}: {exit_transaction} @ {exit_price:.2f}, P&L: {position.realized_pnl:.2f}")
                else:
                    logger.error(f"Exit order failed for {position.symbol}: {exit_result.get('message')}")
            else:
                self._log(position.symbol, "DRY_RUN_EXIT", 
                         f"DRY RUN: Would exit {position.direction} @ {exit_price:.2f} due to {exit_reason}")
                
        except Exception as e:
            trading_logger.log_error("POSITION_EXIT_ERROR", str(e), {
                "symbol": position.symbol,
                "exit_reason": exit_reason,
                "exit_price": exit_price
            })
            logger.error(f"Position exit error for {position.symbol}: {e}")
    
    async def _force_exit_all_positions(self):
        """Force exit all positions at market close"""
        active_positions = [p for p in self.positions if p.status == "ACTIVE"]
        if active_positions:
            trading_logger.log_system_event("FORCE_EXIT_INITIATED", {
                "positions_count": len(active_positions),
                "time": datetime.now().isoformat()
            })
            
        for position in active_positions:
            await self._exit_position(position, position.current_price, "FORCE_EXIT")
            # Mark state as completed
            if position.symbol in self.strategy_states:
                self.strategy_states[position.symbol].trade_completed = True

    async def _emergency_exit_all_positions(self):
        """Emergency exit all positions before auto square-off"""
        active_positions = [p for p in self.positions if p.status == "ACTIVE"]
        if active_positions:
            trading_logger.log_system_event("EMERGENCY_EXIT_INITIATED", {
                "positions_count": len(active_positions),
                "reason": "Pre-auto-squareoff protection",
                "time": datetime.now().isoformat()
            })
            
        for position in active_positions:
            # Use market orders for immediate execution
            await self._exit_position(position, None, "EMERGENCY_EXIT")
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
        """Get actual historical data from Zerodha"""
        try:
            # Get instrument token for symbol
            instruments = await self.zerodha.get_instruments()
            instrument = next((i for i in instruments if i['symbol'] == symbol), None)
            if not instrument:
                self._log(symbol, "ERROR", f"Instrument not found: {symbol}")
                return []
            
            # Get real historical data for last 2 days
            from_date = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")
            to_date = datetime.now().strftime("%Y-%m-%d")
            
            raw_data = await self.zerodha.get_historical_data(
                instrument['token'], 
                from_date, 
                to_date, 
                self.CANDLE_INTERVAL
            )
            
            if not raw_data:
                self._log(symbol, "ERROR", "No historical data received")
                return []
            
            candles = []
            for data in raw_data:
                candles.append(CandleData(
                    timestamp=data['date'],
                    open=float(data['open']),
                    high=float(data['high']),
                    low=float(data['low']),
                    close=float(data['close']),
                    volume=int(data['volume'])
                ))
            
            return candles
            
        except Exception as e:
            self._log(symbol, "ERROR", f"Failed to get candle data: {str(e)}")
            return []
    
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
    
    def _log_setup_detection(self, symbol: str, setup_type: str, setup_time: str, message: str):
        """Log setup detection in the required format: [10:00 AM] Setup detected for Reliance: BUY (10 AM candle closed above 50-SMA)"""
        formatted_message = f"[{setup_time}] {message}"
        
        # Create detailed log entry
        log_entry = StrategyLog(
            timestamp=datetime.now().isoformat(),
            symbol=symbol,
            event="SETUP_DETECTION",
            message=formatted_message
        )
        self.logs.append(log_entry)
        
        # Also log to trading logger for database persistence
        trading_logger.log_setup_detection(symbol, setup_type, {
            "setup_time": setup_time,
            "message": message,
            "formatted_message": formatted_message,
            "category": "SETUP_DETECTION"
        })
        
        # Print to console for immediate visibility
        print(formatted_message)
        logger.info(formatted_message)
        
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
    
    def _is_market_open(self) -> bool:
        """Check if market is currently open"""
        current_time = datetime.now().time()
        return time(9, 15) <= current_time <= time(15, 30)
    
    async def update_settings(self, new_settings: dict):
        """Update trading settings"""
        for key, value in new_settings.items():
            if hasattr(self.settings, key):
                setattr(self.settings, key, value)
        
        self._log("SYSTEM", "SETTINGS_UPDATED", f"Settings updated: {new_settings}")