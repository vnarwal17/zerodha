import asyncio
import logging
from typing import Callable, Any
from kiteconnect.exceptions import TokenException, NetworkException, InputException, KiteException

logger = logging.getLogger(__name__)

class TradingBotException(Exception):
    def __init__(self, message: str, error_code: str, status_code: int = 400):
        self.message = message
        self.error_code = error_code
        self.status_code = status_code
        super().__init__(self.message)

class EnhancedErrorHandler:
    def __init__(self, zerodha_client):
        self.zerodha_client = zerodha_client
        
    async def handle_api_call(self, func: Callable, *args, **kwargs) -> Any:
        """Handle API calls with comprehensive error handling and retries"""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                return await func(*args, **kwargs)
            except TokenException:
                logger.warning(f"Token exception on attempt {attempt + 1}")
                await self.zerodha_client.refresh_session_if_needed()
                if attempt == max_retries - 1:
                    raise TradingBotException("Session expired - please login again", "SESSION_EXPIRED")
            except NetworkException as e:
                logger.warning(f"Network exception on attempt {attempt + 1}: {str(e)}")
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
                if attempt == max_retries - 1:
                    raise TradingBotException("Network error - please try again", "NETWORK_ERROR")
            except InputException as e:
                # Don't retry input errors
                logger.error(f"Input validation error: {str(e)}")
                raise TradingBotException(f"Invalid parameters: {e}", "INVALID_INPUT")
            except KiteException as e:
                if hasattr(e, 'code') and e.code == 429:  # Rate limit exceeded
                    logger.warning("Rate limit exceeded, waiting 60 seconds")
                    await asyncio.sleep(60)  # Wait 1 minute
                    continue
                logger.error(f"Kite API error: {str(e)}")
                raise TradingBotException(f"API error: {e}", "API_ERROR")
            except Exception as e:
                logger.error(f"Unexpected error on attempt {attempt + 1}: {str(e)}")
                if attempt == max_retries - 1:
                    raise TradingBotException(f"Unexpected error: {e}", "UNKNOWN_ERROR")
                await asyncio.sleep(2 ** attempt)
        
        raise TradingBotException("Max retries exceeded", "MAX_RETRIES_EXCEEDED")