import asyncio
import logging
from typing import Dict, List, Callable, Optional
from kiteconnect import KiteTicker
from datetime import datetime

logger = logging.getLogger(__name__)

class WebSocketManager:
    def __init__(self, api_key: str, access_token: str):
        self.api_key = api_key
        self.access_token = access_token
        self.kws = None
        self.subscribed_tokens = []
        self.is_connected = False
        self.reconnect_attempts = 0
        self.max_reconnect_delay = 300  # 5 minutes
        self.tick_callback: Optional[Callable] = None
        
    def setup_websocket(self):
        """Initialize WebSocket connection"""
        try:
            self.kws = KiteTicker(self.api_key, self.access_token)
            self.kws.on_ticks = self.on_ticks
            self.kws.on_connect = self.on_connect
            self.kws.on_close = self.on_close
            self.kws.on_error = self.on_error
            self.kws.on_reconnect = self.on_reconnect
            self.kws.on_noreconnect = self.on_noreconnect
            logger.info("WebSocket setup completed")
        except Exception as e:
            logger.error(f"WebSocket setup error: {e}")
            
    async def connect(self):
        """Connect to WebSocket"""
        try:
            if not self.kws:
                self.setup_websocket()
            self.kws.connect(threaded=True)
        except Exception as e:
            logger.error(f"WebSocket connection error: {e}")
            await self.handle_reconnect()
            
    def subscribe(self, tokens: List[int]):
        """Subscribe to instrument tokens"""
        try:
            if self.is_connected and tokens:
                self.kws.subscribe(tokens)
                self.kws.set_mode(self.kws.MODE_QUOTE, tokens)  # OHLCV data
                self.subscribed_tokens = tokens
                logger.info(f"Subscribed to {len(tokens)} instruments")
        except Exception as e:
            logger.error(f"Subscription error: {e}")
            
    def unsubscribe(self, tokens: List[int]):
        """Unsubscribe from instrument tokens"""
        try:
            if self.is_connected:
                self.kws.unsubscribe(tokens)
                self.subscribed_tokens = [t for t in self.subscribed_tokens if t not in tokens]
        except Exception as e:
            logger.error(f"Unsubscription error: {e}")
            
    def set_tick_callback(self, callback: Callable):
        """Set callback function for tick data"""
        self.tick_callback = callback
        
    def on_ticks(self, ws, ticks):
        """Handle incoming tick data"""
        try:
            if self.tick_callback:
                for tick in ticks:
                    # Process each tick
                    self.tick_callback(tick)
        except Exception as e:
            logger.error(f"Tick processing error: {e}")
            
    def on_connect(self, ws, response):
        """Handle WebSocket connection"""
        self.is_connected = True
        self.reconnect_attempts = 0
        logger.info("WebSocket connected")
        
        # Re-subscribe to previous tokens if any
        if self.subscribed_tokens:
            self.subscribe(self.subscribed_tokens)
            
    def on_close(self, ws, code, reason):
        """Handle WebSocket disconnection"""
        self.is_connected = False
        logger.warning(f"WebSocket disconnected: {code} - {reason}")
        
    def on_error(self, ws, code, reason):
        """Handle WebSocket errors"""
        logger.error(f"WebSocket error: {code} - {reason}")
        
    def on_reconnect(self, ws, attempts_count):
        """Handle WebSocket reconnection"""
        logger.info(f"WebSocket reconnecting, attempt: {attempts_count}")
        
    def on_noreconnect(self, ws):
        """Handle when WebSocket stops reconnecting"""
        logger.error("WebSocket stopped reconnecting")
        asyncio.create_task(self.handle_reconnect())
        
    async def handle_reconnect(self):
        """Handle manual reconnection with exponential backoff"""
        self.reconnect_attempts += 1
        delay = min(self.max_reconnect_delay, 10 * self.reconnect_attempts)
        
        logger.info(f"Attempting reconnection in {delay} seconds (attempt {self.reconnect_attempts})")
        await asyncio.sleep(delay)
        
        try:
            await self.connect()
        except Exception as e:
            logger.error(f"Reconnection failed: {e}")
            if self.reconnect_attempts < 10:  # Limit reconnection attempts
                await self.handle_reconnect()
                
    def disconnect(self):
        """Disconnect WebSocket"""
        try:
            if self.kws and self.is_connected:
                self.kws.close()
                self.is_connected = False
                logger.info("WebSocket disconnected")
        except Exception as e:
            logger.error(f"WebSocket disconnect error: {e}")