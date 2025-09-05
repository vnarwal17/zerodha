import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Zerodha API endpoints
const KITE_API_BASE = 'https://api.kite.trade'

interface TradingSymbol {
  symbol: string;
  instrument_token: number;
  exchange: string;
}

interface CandleData {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StrategySignal {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  price: number;
  quantity: number;
  reason: string;
}

interface ApiResponse<T = any> {
  status: string;
  message: string;
  data?: T;
}

// Your specific strategy implementation
function calculateSMA50(prices: number[]): number {
  if (prices.length < 50) return 0;
  const sum = prices.slice(-50).reduce((a, b) => a + b, 0);
  return sum / 50;
}

function isValidSetupCandle(candle: CandleData, sma50: number): { isValid: boolean; bias: 'LONG' | 'SHORT' | 'INVALID' } {
  const { open, high, low, close } = candle;
  
  if (close > sma50) {
    // Long bias setup - bearish hammer/doji with lower wick touching SMA
    const bodySize = Math.abs(close - open);
    const totalRange = high - low;
    const lowerWick = Math.min(open, close) - low;
    const upperWick = high - Math.max(open, close);
    
    if (bodySize / totalRange <= 0.3 && lowerWick >= bodySize * 2 && low <= sma50 && close > sma50) {
      return { isValid: true, bias: 'LONG' };
    }
  } else if (close < sma50) {
    // Short bias setup - bearish shooting star/doji with upper wick touching SMA
    const bodySize = Math.abs(close - open);
    const totalRange = high - low;
    const lowerWick = Math.min(open, close) - low;
    const upperWick = high - Math.max(open, close);
    
    if (bodySize / totalRange <= 0.3 && upperWick >= bodySize * 2 && high >= sma50 && close < sma50) {
      return { isValid: true, bias: 'SHORT' };
    }
  }
  
  return { isValid: false, bias: 'INVALID' };
}

function isValidRejectionCandle(candle: CandleData, bias: 'LONG' | 'SHORT', sma50: number): boolean {
  const { open, high, low, close } = candle;
  
  if (bias === 'LONG') {
    // For long bias, we want a bullish candle that closes above SMA
    const bodySize = Math.abs(close - open);
    const totalRange = high - low;
    const wickTouchesSMA = low <= sma50;
    const wickPercentage = ((Math.min(open, close) - low) / totalRange) * 100;
    
    if (close > open && close > sma50 && wickTouchesSMA && wickPercentage >= 15) {
      return true;
    }
  } else if (bias === 'SHORT') {
    // For short bias, we want a bearish candle that closes below SMA
    const bodySize = Math.abs(close - open);
    const totalRange = high - low;
    const wickTouchesSMA = high >= sma50;
    const wickPercentage = ((high - Math.max(open, close)) / totalRange) * 100;
    
    if (close < open && close < sma50 && wickTouchesSMA && wickPercentage >= 15) {
      return true;
    }
  }
  
  return false;
}

function analyzeIntradayStrategy(candles: CandleData[]): StrategySignal {
  if (candles.length < 50) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'Insufficient candles for 50-period SMA calculation'
    };
  }

  const closes = candles.map(c => c.close);
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  const currentMinute = currentTime.getMinutes();
  
  // Only trade between 10 AM and 1 PM (entry window)
  if (currentHour < 10 || (currentHour >= 13)) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'Outside trading hours (10 AM - 1 PM entry window)'
    };
  }

  // Find the 10 AM setup candle (09:57-09:59)
  // For this implementation, we'll use the candle that should represent this timeframe
  const setupCandleIndex = candles.length - 1; // Most recent for demo
  const setupCandle = candles[setupCandleIndex];
  const sma50 = calculateSMA50(closes);
  
  if (sma50 === 0) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'SMA50 calculation failed'
    };
  }

  // Check for valid setup candle
  const setupResult = isValidSetupCandle(setupCandle, sma50);
  
  if (!setupResult.isValid) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'No valid setup candle found'
    };
  }

  // Look for rejection candle in subsequent candles
  for (let i = setupCandleIndex + 1; i < candles.length; i++) {
    const rejectionCandle = candles[i];
    
    if (isValidRejectionCandle(rejectionCandle, setupResult.bias, sma50)) {
      const action = setupResult.bias === 'LONG' ? 'BUY' : 'SELL';
      const entryPrice = setupResult.bias === 'LONG' ? rejectionCandle.high : rejectionCandle.low;
      const stopLoss = setupResult.bias === 'LONG' ? rejectionCandle.low : rejectionCandle.high;
      const target = setupResult.bias === 'LONG' 
        ? entryPrice + (entryPrice - stopLoss) * 2 
        : entryPrice - (stopLoss - entryPrice) * 2;

      return {
        symbol: '',
        action: action,
        price: entryPrice,
        quantity: 1, // This would be calculated based on risk management
        reason: `Valid ${setupResult.bias} setup with rejection candle. Entry: ${entryPrice}, Stop: ${stopLoss}, Target: ${target}`
      };
    }
  }

  return {
    symbol: '',
    action: 'HOLD',
    price: 0,
    quantity: 0,
    reason: 'Setup found but no valid rejection candle yet'
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const requestBody = await req.json()
    console.log('Request body:', requestBody)
    
    const { path, ...data } = requestBody
    
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    switch (path) {
      case '/set_credentials':
        const { api_key, api_secret } = data
        
        if (!api_key || !api_secret) {
          return Response.json({
            status: "error",
            message: "API key and secret are required"
          }, { headers: corsHeaders })
        }

        const { error } = await supabaseClient
          .from('trading_credentials')
          .upsert({
            id: 1,
            api_key: api_key,
            api_secret: api_secret,
            updated_at: new Date().toISOString()
          })

        if (error) {
          console.error('Database error:', error)
          return Response.json({
            status: "error",
            message: error.message
          }, { headers: corsHeaders })
        }

        return Response.json({
          status: "success",
          message: "Credentials saved successfully"
        }, { headers: corsHeaders })

      default:
        return Response.json({
          status: "error",
          message: "Invalid endpoint"
        }, { headers: corsHeaders })
    }
  } catch (error) {
    console.error('Edge function error:', error)
    return Response.json({
      status: "error",
      message: "Internal server error"
    }, { headers: corsHeaders })
  }
})