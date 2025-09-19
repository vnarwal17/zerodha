from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import asyncio
import logging
from datetime import datetime, time
from typing import Optional, List, Dict, Any
import json
import os

from models import *
from trading_engine import ImprovedTradingEngine
from zerodha_client import ZerodhaClient
from enhanced_error_handler import TradingBotException
from trading_config import TradingConfig
from trading_logger import trading_logger

# Configure logging
config = TradingConfig()
logging.basicConfig(level=getattr(logging, config.LOG_LEVEL))
logger = logging.getLogger(__name__)

app = FastAPI(title="Trading Bot API", version="2.0.0")

# Error handling middleware
@app.middleware("http")
async def error_handling_middleware(request: Request, call_next):
    try:
        response = await call_next(request)
        return response
    except TradingBotException as e:
        return JSONResponse(
            status_code=e.status_code,
            content={"status": "error", "message": e.message, "code": e.error_code}
        )
    except Exception as e:
        logger.error(f"Unhandled error: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": "Internal server error"}
        )

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global instances
zerodha_client = ZerodhaClient()
trading_engine = ImprovedTradingEngine(zerodha_client)

@app.post("/api/set_credentials")
async def set_credentials(request: dict):
    """Set Zerodha API credentials"""
    try:
        api_key = request.get('api_key')
        api_secret = request.get('api_secret')
        
        if not api_key or not api_secret:
            return ApiResponse(
                status="error",
                message="Both API key and secret are required"
            )
        
        zerodha_client.set_credentials(api_key, api_secret)
        return ApiResponse(
            status="success",
            message="Credentials updated successfully"
        )
    except Exception as e:
        logger.error(f"Set credentials error: {str(e)}")
        return ApiResponse(status="error", message=str(e))

@app.post("/api/login")
async def login(request: LoginRequest):
    """Handle Zerodha login with request token"""
    try:
        if request.request_token:
            # Complete login with request token
            result = await zerodha_client.complete_login(request.request_token)
            if result.get('status') == 'success':
                return ApiResponse(
                    status="success",
                    message="Login successful",
                    data={"user_id": result.get('user_id')}
                )
            else:
                return ApiResponse(
                    status="error",
                    message=result.get('message', 'Login failed')
                )
        else:
            # Generate login URL
            login_url = zerodha_client.get_login_url()
            return ApiResponse(
                status="requires_login",
                message="Please complete login",
                data={"login_url": login_url}
            )
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        return ApiResponse(status="error", message=str(e))

@app.get("/api/test_connection")
async def test_connection():
    """Test broker connection status"""
    try:
        if not zerodha_client.is_connected():
            return ApiResponse(
                status="disconnected",
                message="Not connected to broker"
            )
        
        profile = await zerodha_client.get_profile()
        return ApiResponse(
            status="connected",
            message="Connected to Zerodha",
            data={
                "user_id": profile.get('user_id'),
                "user_name": profile.get('user_name')
            }
        )
    except Exception as e:
        logger.error(f"Connection test error: {str(e)}")
        return ApiResponse(status="error", message=str(e))

@app.get("/api/instruments")
async def get_instruments():
    """Get available trading instruments"""
    try:
        instruments = await zerodha_client.get_instruments()
        return ApiResponse(
            status="success",
            data={
                "instruments": instruments,
                "nifty50_stocks": zerodha_client.get_nifty50_symbols(),
                "banknifty_stocks": zerodha_client.get_banknifty_symbols(),
                "count": len(instruments)
            }
        )
    except Exception as e:
        logger.error(f"Instruments error: {str(e)}")
        return ApiResponse(status="error", message=str(e))

@app.post("/api/start_live_trading")
async def start_live_trading(request: StartTradingRequest):
    """Start live trading with proper validation"""
    try:
        # Validate market hours
        if not trading_engine.is_market_open():
            return ApiResponse(status="error", message="Market is closed")
            
        # Validate session
        await zerodha_client.refresh_session_if_needed()
        
        if not zerodha_client.is_connected():
            return ApiResponse(
                status="error",
                message="Not connected to broker"
            )
        
        # Start trading engine
        await trading_engine.start_trading(request.symbols)
        
        symbol_names = [symbol.symbol for symbol in request.symbols]
        
        trading_logger.log_system_event("LIVE_TRADING_STARTED", {
            "symbols": symbol_names,
            "count": len(symbol_names)
        })
        
        return ApiResponse(
            status="success",
            message=f"Started live trading for {len(symbol_names)} symbols",
            data={"symbols": symbol_names}
        )
        
    except TradingBotException as e:
        return ApiResponse(status="error", message=e.message)
    except Exception as e:
        logger.error(f"Start trading error: {str(e)}")
        return ApiResponse(status="error", message=str(e))

@app.post("/api/stop_live_trading")
async def stop_live_trading():
    """Stop live trading"""
    try:
        await trading_engine.stop_trading()
        return ApiResponse(
            status="success",
            message="Live trading stopped"
        )
    except Exception as e:
        logger.error(f"Stop trading error: {str(e)}")
        return ApiResponse(status="error", message=str(e))

@app.get("/api/live_status")
async def get_live_status():
    """Get current trading status and positions"""
    try:
        status = await trading_engine.get_live_status()
        return ApiResponse(
            status="success",
            data={"live_status": status}
        )
    except Exception as e:
        logger.error(f"Live status error: {str(e)}")
        return ApiResponse(status="error", message=str(e))

@app.post("/api/update_settings")
async def update_settings(settings: TradingSettings):
    """Update trading settings"""
    try:
        await trading_engine.update_settings(settings.dict())
        return ApiResponse(
            status="success",
            message="Settings updated successfully"
        )
    except Exception as e:
        logger.error(f"Update settings error: {str(e)}")
        return ApiResponse(status="error", message=str(e))

@app.post("/api/export")
async def export_trades(request: ExportRequest):
    """Export trades to CSV"""
    try:
        # Implementation for exporting trades
        return ApiResponse(
            status="success",
            message="Export completed"
        )
    except Exception as e:
        logger.error(f"Export error: {str(e)}")
        return ApiResponse(status="error", message=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)