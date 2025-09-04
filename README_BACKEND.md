# Trading Bot Backend

A Python FastAPI backend that implements the detailed intraday trading strategy with Zerodha integration.

## Setup Instructions

1. **Install Dependencies**
```bash
pip install -r requirements.txt
```

2. **Configure Zerodha API (choose one method):**

   **Method 1: Environment Variables (Recommended)**
   ```bash
   export ZERODHA_API_KEY="your_actual_api_key"
   export ZERODHA_API_SECRET="your_actual_api_secret"
   ```

   **Method 2: Config File**
   - Copy `zerodha_config.json.example` to `zerodha_config.json`
   - Edit `zerodha_config.json` with your credentials:
     ```json
     {
       "api_key": "your_actual_api_key",
       "api_secret": "your_actual_api_secret"
     }
     ```

   **Method 3: Runtime (via API)**
   - Use the `/api/set_credentials` endpoint to set credentials dynamically

3. **Run the Backend**
```bash
python main.py
```

The server will start on `http://127.0.0.1:8000`

## Strategy Implementation

### Intraday Strategy Details
- **Timeframe**: 3-minute candles
- **Setup Time**: 10:00 AM (using 09:57-09:59 candle)
- **SMA**: 50-period Simple Moving Average
- **Risk:Reward**: 1:5 ratio
- **Entry Window**: Until 1:00 PM
- **Force Exit**: 3:00 PM

### Key Features
1. **10 AM Setup Detection**: Validates candle position relative to SMA
2. **Rejection Candle Confirmation**: Minimum 15% wick requirement
3. **Skip Period**: 2 candles after rejection before entry
4. **Position Management**: Automatic SL/Target execution
5. **Daily Reset**: Fresh state each trading day

## API Endpoints

- `POST /api/login` - Zerodha authentication
- `GET /api/test_connection` - Test broker connection
- `GET /api/instruments` - Get available symbols
- `POST /api/start_live_trading` - Start strategy execution
- `POST /api/stop_live_trading` - Stop trading
- `GET /api/live_status` - Get real-time status
- `POST /api/update_settings` - Update trading parameters

## Files Structure

- `main.py` - FastAPI application and API endpoints
- `trading_engine.py` - Core strategy implementation
- `zerodha_client.py` - Zerodha API integration
- `models.py` - Pydantic models for data structures

## Trading Settings

- **Dry Run Mode**: Test without real orders
- **Position Sizing**: Fixed capital or risk percentage
- **Capital per Trade**: ₹100,000 default
- **Leverage**: Configurable multiplier

## Token Management

Access tokens are automatically saved and reused until 6:30 AM next day, matching Zerodha's token expiry schedule.

## Safety Features

- SMA crossing invalidates the day
- Force exit at market close
- One trade per symbol per day
- Comprehensive logging and monitoring