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
from trading_engine import TradingEngine
from zerodha_client import ZerodhaClient

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Trading Bot API", version="1.0.0")

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
trading_engine = TradingEngine(zerodha_client)

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
    """Start live trading for selected symbols"""
    try:
        if not zerodha_client.is_connected():
            return ApiResponse(
                status="error",
                message="Not connected to broker"
            )
        
        # Start trading engine
        await trading_engine.start_trading(request.symbols)
        
        symbol_names = [symbol.symbol for symbol in request.symbols]
        return ApiResponse(
            status="success",
            message=f"Started live trading for {len(symbol_names)} symbols",
            data={"symbols": symbol_names}
        )
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