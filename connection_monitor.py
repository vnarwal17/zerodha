import asyncio
import logging
from datetime import datetime
from typing import Optional
from zerodha_client import ZerodhaClient

logger = logging.getLogger(__name__)

class ConnectionMonitor:
    def __init__(self, zerodha_client: ZerodhaClient):
        self.zerodha_client = zerodha_client
        self.is_monitoring = False
        self.last_successful_check = None
        self.consecutive_failures = 0
        self.max_consecutive_failures = 3
        
    async def start_monitoring(self):
        """Start connection health monitoring"""
        self.is_monitoring = True
        logger.info("Connection monitoring started")
        
        while self.is_monitoring:
            try:
                await self.check_connection_health()
                await asyncio.sleep(30)  # Check every 30 seconds
            except Exception as e:
                logger.error(f"Connection monitoring error: {e}")
                await asyncio.sleep(60)
                
    async def check_connection_health(self):
        """Check connection health"""
        try:
            # Test connection with a simple API call
            profile = await self.zerodha_client.get_profile()
            
            if profile and profile.get('user_id'):
                self.last_successful_check = datetime.now()
                self.consecutive_failures = 0
                logger.debug("Connection health check: OK")
            else:
                raise Exception("Invalid profile response")
                
        except Exception as e:
            self.consecutive_failures += 1
            logger.warning(f"Connection health check failed (attempt {self.consecutive_failures}): {e}")
            
            if self.consecutive_failures >= self.max_consecutive_failures:
                logger.error("Multiple consecutive connection failures, attempting session refresh")
                try:
                    await self.zerodha_client.refresh_session_if_needed()
                    self.consecutive_failures = 0
                except Exception as refresh_error:
                    logger.error(f"Session refresh failed: {refresh_error}")
                    
    def stop_monitoring(self):
        """Stop connection monitoring"""
        self.is_monitoring = False
        logger.info("Connection monitoring stopped")