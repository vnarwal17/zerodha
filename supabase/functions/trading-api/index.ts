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

// ============= COMPREHENSIVE INTRADAY STRATEGY IMPLEMENTATION =============

function calculateSMA50(prices: number[]): number {
  if (prices.length < 50) return 0;
  const sum = prices.slice(-50).reduce((a, b) => a + b, 0);
  return sum / 50;
}

function isTimeInRange(timestamp: string, startTime: string, endTime: string): boolean {
  const time = new Date(timestamp).toTimeString().slice(0, 8);
  return time >= startTime && time <= endTime;
}

function getCandleTime(timestamp: string): string {
  return new Date(timestamp).toTimeString().slice(0, 8);
}

function isValidSetupCandle(candle: CandleData, sma50: number): { isValid: boolean; bias: 'LONG' | 'SHORT' | 'INVALID' } {
  const { open, high, low, close } = candle;
  
  // Check if entire candle is strictly above SMA (Long setup)
  if (low > sma50 && high > sma50 && open > sma50 && close > sma50) {
    return { isValid: true, bias: 'LONG' };
  }
  
  // Check if entire candle is strictly below SMA (Short setup)
  if (low < sma50 && high < sma50 && open < sma50 && close < sma50) {
    return { isValid: true, bias: 'SHORT' };
  }
  
  // Invalid if any part touches or crosses SMA
  return { isValid: false, bias: 'INVALID' };
}

function isValidRejectionCandle(candle: CandleData, bias: 'LONG' | 'SHORT', sma50: number): boolean {
  const { open, high, low, close } = candle;
  const candleRange = high - low;
  
  if (bias === 'LONG') {
    // Lower wick must touch SMA, body and close must be above SMA
    const lowerWick = Math.min(open, close) - low;
    const wickTouchesSMA = low <= sma50 && Math.min(open, close) > sma50;
    const wickSizeValid = lowerWick >= (candleRange * 0.15);
    
    return wickTouchesSMA && wickSizeValid && close > sma50 && open > sma50;
  } else {
    // Upper wick must touch SMA, body and close must be below SMA
    const upperWick = high - Math.max(open, close);
    const wickTouchesSMA = high >= sma50 && Math.max(open, close) < sma50;
    const wickSizeValid = upperWick >= (candleRange * 0.15);
    
    return wickTouchesSMA && wickSizeValid && close < sma50 && open < sma50;
  }
}

function candleCrossesSMA(candle: CandleData, sma50: number): boolean {
  const { open, high, low, close } = candle;
  // Check if candle fully crosses SMA (both sides)
  return (low < sma50 && high > sma50);
}

function analyzeComprehensiveStrategy(candles: CandleData[]): StrategySignal {
  if (candles.length < 50) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'Insufficient data for SMA50 calculation (need at least 50 candles)'
    };
  }

  // Get closing prices for SMA calculation
  const closes = candles.map(c => c.close);
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

  // Find the 10 AM setup candle (09:57:00 – 09:59:59)
  let setupCandleIndex = -1;
  let setupCandle: CandleData | null = null;
  
  for (let i = 0; i < candles.length; i++) {
    const candleTime = getCandleTime(candles[i].timestamp);
    if (candleTime >= "09:57:00" && candleTime <= "09:59:59") {
      setupCandleIndex = i;
      setupCandle = candles[i];
      break;
    }
  }

  if (!setupCandle || setupCandleIndex === -1) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'No 10 AM setup candle found (09:57:00 – 09:59:59)'
    };
  }

  // Validate 10 AM setup
  const setupResult = isValidSetupCandle(setupCandle, sma50);
  
  if (!setupResult.isValid) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: `Invalid 10 AM setup: candle touches/crosses SMA. SMA: ${sma50.toFixed(2)}, Candle: H:${setupCandle.high} L:${setupCandle.low} O:${setupCandle.open} C:${setupCandle.close}`
    };
  }

  // Look for rejection candle after setup
  let rejectionCandleIndex = -1;
  let rejectionCandle: CandleData | null = null;

  for (let i = setupCandleIndex + 1; i < candles.length; i++) {
    const candle = candles[i];
    
    // Check if any candle fully crosses SMA (invalidates day)
    if (candleCrossesSMA(candle, sma50)) {
      return {
        symbol: '',
        action: 'HOLD',
        price: 0,
        quantity: 0,
        reason: `Day invalidated: candle at ${getCandleTime(candle.timestamp)} crossed SMA fully`
      };
    }

    // Check for valid rejection candle
    if (isValidRejectionCandle(candle, setupResult.bias, sma50)) {
      rejectionCandleIndex = i;
      rejectionCandle = candle;
      break;
    }
  }

  if (!rejectionCandle || rejectionCandleIndex === -1) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: `Valid ${setupResult.bias} setup found but no rejection candle yet. Waiting for wick to touch SMA.`
    };
  }

  // Skip 2 candles after rejection
  const skipEndIndex = rejectionCandleIndex + 2;
  if (skipEndIndex >= candles.length) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: `Rejection candle found, waiting for skip period (2 candles) to complete`
    };
  }

  // Check if we're still in entry window (until 13:00:00)
  const currentTime = getCandleTime(candles[candles.length - 1].timestamp);
  if (currentTime > "13:00:00") {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'Entry window closed (after 1 PM)'
    };
  }

  // Check if SL would have been hit during skip period
  for (let i = rejectionCandleIndex + 1; i <= skipEndIndex && i < candles.length; i++) {
    const skipCandle = candles[i];
    if (setupResult.bias === 'LONG') {
      const stopLoss = rejectionCandle.low - 0.15;
      if (skipCandle.low <= stopLoss) {
        return {
          symbol: '',
          action: 'HOLD',
          price: 0,
          quantity: 0,
          reason: `Trade cancelled: SL would have been hit during skip period at ${getCandleTime(skipCandle.timestamp)}`
        };
      }
    } else {
      const stopLoss = rejectionCandle.high + 0.15;
      if (skipCandle.high >= stopLoss) {
        return {
          symbol: '',
          action: 'HOLD',
          price: 0,
          quantity: 0,
          reason: `Trade cancelled: SL would have been hit during skip period at ${getCandleTime(skipCandle.timestamp)}`
        };
      }
    }
  }

  // Calculate entry, stop loss, and target based on strategy rules
  let entryPrice: number;
  let stopLoss: number;
  let target: number;
  let action: 'BUY' | 'SELL';

  if (setupResult.bias === 'LONG') {
    action = 'BUY';
    entryPrice = rejectionCandle.high + 0.10;
    stopLoss = rejectionCandle.low - 0.15;
    const risk = entryPrice - stopLoss;
    target = entryPrice + (risk * 5); // 5:1 RR
  } else {
    action = 'SELL';
    entryPrice = rejectionCandle.low - 0.10;
    stopLoss = rejectionCandle.high + 0.15;
    const risk = stopLoss - entryPrice;
    target = entryPrice - (risk * 5); // 5:1 RR
  }

  // Calculate position size (₹100,000 fixed capital)
  const fixedCapital = 100000;
  const riskPerShare = Math.abs(entryPrice - stopLoss);
  const quantity = Math.floor(fixedCapital / entryPrice);

  return {
    symbol: '',
    action: action,
    price: entryPrice,
    quantity: quantity,
    reason: `${setupResult.bias} setup confirmed with rejection candle. Entry: ₹${entryPrice.toFixed(2)}, SL: ₹${stopLoss.toFixed(2)}, Target: ₹${target.toFixed(2)} (5:1 RR). Risk per share: ₹${riskPerShare.toFixed(2)}`
  };
}

// ============= LOGGING UTILITIES =============
async function logActivity(supabaseClient: any, level: string, message: string, symbol?: string) {
  try {
    await supabaseClient
      .from('trading_logs')
      .insert({
        level: level,
        message: message,
        symbol: symbol || null,
        created_at: new Date().toISOString()
      })
  } catch (error) {
    console.error('Failed to log activity:', error)
  }
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
          await logActivity(supabaseClient, 'error', `Failed to save credentials: ${error.message}`)
          console.error('Database error:', error)
          return Response.json({
            status: "error",
            message: error.message
          }, { headers: corsHeaders })
        }

        await logActivity(supabaseClient, 'info', 'Zerodha API credentials saved successfully')
        return Response.json({
          status: "success",
          message: "Credentials saved successfully"
        }, { headers: corsHeaders })

      case '/login':
        const { request_token } = data
        
        if (request_token) {
          // Get API credentials for authentication
          const { data: credentialsData } = await supabaseClient
            .from('trading_credentials')
            .select('api_key, api_secret')
            .eq('id', 1)
            .maybeSingle()

          if (!credentialsData) {
            await logActivity(supabaseClient, 'error', 'Login failed: API credentials not found')
            return Response.json({
              status: "error",
              message: "API credentials not found. Please set up credentials first."
            }, { headers: corsHeaders })
          }

          await logActivity(supabaseClient, 'info', 'Starting Zerodha authentication process')

          // Calculate checksum: SHA-256 of api_key + request_token + api_secret
          const checksum_string = credentialsData.api_key + request_token + credentialsData.api_secret
          const encoder = new TextEncoder()
          const data_array = encoder.encode(checksum_string)
          const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data_array)
          const hashArray = Array.from(new Uint8Array(hashBuffer))
          const checksum = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

          // Exchange request_token for access_token via Zerodha API
          try {
            const tokenResponse = await fetch(`${KITE_API_BASE}/session/token`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Kite-Version': '3'
              },
              body: new URLSearchParams({
                api_key: credentialsData.api_key,
                request_token: request_token,
                checksum: checksum
              })
            })

            if (!tokenResponse.ok) {
              const errorData = await tokenResponse.json()
              await logActivity(supabaseClient, 'error', `Zerodha authentication failed: ${errorData.message}`)
              return Response.json({
                status: "error",
                message: errorData.message || "Authentication failed"
              }, { headers: corsHeaders })
            }

            const tokenData = await tokenResponse.json()
            
            // Save session data
            const { error: sessionError } = await supabaseClient
              .from('trading_sessions')
              .upsert({
                id: 1,
                access_token: tokenData.data.access_token,
                user_id: tokenData.data.user_id,
                user_name: tokenData.data.user_name || tokenData.data.user_id,
                status: 'authenticated',
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
                updated_at: new Date().toISOString()
              })

            if (sessionError) {
              await logActivity(supabaseClient, 'error', `Failed to save session: ${sessionError.message}`)
              return Response.json({
                status: "error",
                message: "Failed to save session"
              }, { headers: corsHeaders })
            }

            await logActivity(supabaseClient, 'success', `Successfully authenticated with Zerodha. User: ${tokenData.data.user_id}`)
            return Response.json({
              status: "success",
              message: "Login successful",
              data: {
                user_id: tokenData.data.user_id,
                user_name: tokenData.data.user_name || tokenData.data.user_id
              }
            }, { headers: corsHeaders })
          } catch (error) {
            await logActivity(supabaseClient, 'error', `Authentication error: ${error.message}`)
            return Response.json({
              status: "error",
              message: "Authentication failed: " + error.message
            }, { headers: corsHeaders })
          }
        } else {
          // Return login URL
          const { data: credentialsData } = await supabaseClient
            .from('trading_credentials')
            .select('api_key')
            .eq('id', 1)
            .maybeSingle()

          if (!credentialsData) {
            return Response.json({
              status: "error",
              message: "API credentials not found. Please set up credentials first."
            }, { headers: corsHeaders })
          }

          await logActivity(supabaseClient, 'info', 'Generated Zerodha login URL for user authentication')
          const loginUrl = `https://kite.trade/connect/login?api_key=${credentialsData.api_key}`
          
          return Response.json({
            status: "pending",
            message: "Please complete login via Zerodha",
            data: {
              login_url: loginUrl
            }
          }, { headers: corsHeaders })
        }
        break

      case '/instruments':
        try {
          const { data: sessionData } = await supabaseClient
            .from('trading_sessions')
            .select('access_token')
            .eq('id', 1)
            .maybeSingle()

          const { data: apiKeyData } = await supabaseClient
            .from('trading_credentials')
            .select('api_key')
            .eq('id', 1)
            .maybeSingle()

          console.log("Session access_token available:", !!sessionData?.access_token)
          console.log("API key available:", !!apiKeyData?.api_key)

          if (!sessionData?.access_token || !apiKeyData?.api_key) {
            await logActivity(supabaseClient, 'error', 'Not authenticated - missing session or API key')
            return Response.json({
              status: "error",
              message: "Not authenticated. Please login to Zerodha first."
            }, { headers: corsHeaders })
          }

          await logActivity(supabaseClient, 'info', 'Fetching instruments from Zerodha API')

          // Fetch instruments from Zerodha
          const instrumentsResponse = await fetch(`${KITE_API_BASE}/instruments`, {
            method: 'GET',
            headers: {
              'Authorization': `token ${apiKeyData.api_key}:${sessionData.access_token}`,
              'X-Kite-Version': '3'
            }
          })

          if (!instrumentsResponse.ok) {
            const errorData = await instrumentsResponse.json()
            return Response.json({
              status: "error",
              message: errorData.message || "Failed to fetch instruments"
            }, { headers: corsHeaders })
          }

          const instrumentsText = await instrumentsResponse.text()
          const lines = instrumentsText.split('\n')
          const instruments = []
          
          // Define Nifty50 and BankNifty stocks
          const nifty50Symbols = [
            'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'HINDUNILVR', 'HDFC', 'ICICIBANK', 'KOTAKBANK',
            'BHARTIARTL', 'ITC', 'SBIN', 'LICI', 'LT', 'HCLTECH', 'AXISBANK', 'ASIANPAINT',
            'MARUTI', 'SUNPHARMA', 'TITAN', 'ULTRACEMCO', 'WIPRO', 'NESTLEIND', 'POWERGRID',
            'BAJFINANCE', 'NTPC', 'TECHM', 'TATACONSUM', 'INDUSINDBK', 'TATAMOTORS', 'COAL',
            'ONGC', 'JSWSTEEL', 'GRASIM', 'HINDALCO', 'ADANIENT', 'TATASTEEL', 'CIPLA',
            'HDFCLIFE', 'BAJAJFINSV', 'DRREDDY', 'EICHERMOT', 'APOLLOHOSP', 'BRITANNIA',
            'DIVISLAB', 'HEROMOTOCO', 'SBILIFE', 'BPCL', 'ADANIPORTS', 'TATAPOWER'
          ]
          
          const bankNiftySymbols = [
            'HDFCBANK', 'ICICIBANK', 'AXISBANK', 'KOTAKBANK', 'SBIN', 'INDUSINDBK',
            'PNB', 'BANKBARODA', 'AUBANK', 'IDFCFIRSTB', 'FEDERALBNK', 'BANDHANBNK'
          ]
          
          // Parse CSV data (skip header) - get all NSE EQ instruments
          for (let i = 1; i < lines.length; i++) {
            const fields = lines[i].split(',')
            if (fields.length >= 11 && fields[2] === 'NSE' && fields[9] === 'EQ') {
              const symbol = fields[3]
              instruments.push({
                symbol: symbol,
                name: fields[4] || symbol,
                token: parseInt(fields[0]),
                exchange: fields[2],
                is_nifty50: nifty50Symbols.includes(symbol),
                is_banknifty: bankNiftySymbols.includes(symbol),
                instrument_token: parseInt(fields[0]),
                exchange_token: fields[1],
                tradingsymbol: fields[3],
                expiry: fields[5],
                strike: fields[6],
                tick_size: parseFloat(fields[7]),
                lot_size: parseInt(fields[8]),
                instrument_type: fields[9],
                segment: fields[10]
              })
            }
          }

          await logActivity(supabaseClient, 'success', `Fetched ${instruments.length} instruments from Zerodha`)
          return Response.json({
            status: "success",
            message: "Instruments fetched successfully",
            data: {
              instruments: instruments,
              nifty50_stocks: nifty50Symbols,
              banknifty_stocks: bankNiftySymbols,
              count: instruments.length
            }
          }, { headers: corsHeaders })
        } catch (error) {
          await logActivity(supabaseClient, 'error', `Failed to fetch instruments: ${error.message}`)
          return Response.json({
            status: "error",
            message: "Failed to fetch instruments: " + error.message
          }, { headers: corsHeaders })
        }
        break

      case '/get_balance':
        try {
          const { data: balanceSessionData } = await supabaseClient
            .from('trading_sessions')
            .select('access_token, user_id')
            .eq('id', 1)
            .maybeSingle()

          const { data: balanceApiKeyData } = await supabaseClient
            .from('trading_credentials')
            .select('api_key')
            .eq('id', 1)
            .maybeSingle()

          if (!balanceSessionData?.access_token || !balanceApiKeyData?.api_key) {
            return Response.json({
              status: "error",
              message: "Not authenticated. Please login to Zerodha first."
            }, { headers: corsHeaders })
          }

          await logActivity(supabaseClient, 'info', 'Fetching account balance from Zerodha')

          const marginsResponse = await fetch(`${KITE_API_BASE}/user/margins`, {
            method: 'GET',
            headers: {
              'Authorization': `token ${balanceApiKeyData.api_key}:${balanceSessionData.access_token}`,
              'X-Kite-Version': '3'
            }
          })

          if (!marginsResponse.ok) {
            const errorData = await marginsResponse.json()
            return Response.json({
              status: "error",
              message: errorData.message || "Failed to fetch balance"
            }, { headers: corsHeaders })
          }

          const marginsData = await marginsResponse.json()
          
          await logActivity(supabaseClient, 'success', `Account balance fetched for user ${balanceSessionData.user_id}`)
          return Response.json({
            status: "success",
            message: "Balance fetched successfully",
            data: {
              balance: marginsData.data,
              user_id: balanceSessionData.user_id
            }
          }, { headers: corsHeaders })
        } catch (error) {
          await logActivity(supabaseClient, 'error', `Failed to fetch balance: ${error.message}`)
          return Response.json({
            status: "error",
            message: "Failed to fetch balance: " + error.message
          }, { headers: corsHeaders })
        }
        break

      case '/start_live_trading':
        const { symbols } = data
        
        if (!symbols || !Array.isArray(symbols)) {
          return Response.json({
            status: "error",
            message: "Symbols array is required"
          }, { headers: corsHeaders })
        }

        try {
          const { error: tradingError } = await supabaseClient
            .from('trading_sessions')
            .update({
              trading_active: true,
              symbols: symbols,
              updated_at: new Date().toISOString()
            })
            .eq('id', 1)

          if (tradingError) {
            return Response.json({
              status: "error",
              message: "Failed to start live trading"
            }, { headers: corsHeaders })
          }

          const symbolNames = symbols.map(s => s.symbol).join(', ')
          await logActivity(supabaseClient, 'success', `Live trading started for symbols: ${symbolNames}`)
          
          return Response.json({
            status: "success",
            message: "Live trading started",
            data: {
              symbols: symbolNames.split(', ')
            }
          }, { headers: corsHeaders })
        } catch (error) {
          await logActivity(supabaseClient, 'error', `Failed to start live trading: ${error.message}`)
          return Response.json({
            status: "error",
            message: "Failed to start live trading: " + error.message
          }, { headers: corsHeaders })
        }
        break

      case '/stop_live_trading':
        try {
          const { error: stopError } = await supabaseClient
            .from('trading_sessions')
            .update({
              trading_active: false,
              updated_at: new Date().toISOString()
            })
            .eq('id', 1)

          if (stopError) {
            return Response.json({
              status: "error",
              message: "Failed to stop live trading"
            }, { headers: corsHeaders })
          }

          await logActivity(supabaseClient, 'info', 'Live trading stopped')
          return Response.json({
            status: "success",
            message: "Live trading stopped"
          }, { headers: corsHeaders })
        } catch (error) {
          await logActivity(supabaseClient, 'error', `Failed to stop live trading: ${error.message}`)
          return Response.json({
            status: "error",
            message: "Failed to stop live trading: " + error.message
          }, { headers: corsHeaders })
        }
        break

      case '/get_historical_data':
        const { symbol, instrument_token, interval = '3minute', days = 30 } = data
        
        if (!symbol || !instrument_token) {
          return Response.json({
            status: "error",
            message: "Symbol and instrument_token are required"
          }, { headers: corsHeaders })
        }

        try {
          const { data: histSessionData } = await supabaseClient
            .from('trading_sessions')
            .select('access_token')
            .eq('id', 1)
            .maybeSingle()

          const { data: histApiKeyData } = await supabaseClient
            .from('trading_credentials')
            .select('api_key')
            .eq('id', 1)
            .maybeSingle()

          if (!histSessionData?.access_token || !histApiKeyData?.api_key) {
            return Response.json({
              status: "error",
              message: "Not authenticated. Please login to Zerodha first."
            }, { headers: corsHeaders })
          }

          await logActivity(supabaseClient, 'info', `Fetching historical data for ${symbol}`, symbol)

          const fromDate = new Date()
          fromDate.setDate(fromDate.getDate() - days)
          
          const histResponse = await fetch(`${KITE_API_BASE}/instruments/historical/${instrument_token}/${interval}?from=${fromDate.toISOString().split('T')[0]}&to=${new Date().toISOString().split('T')[0]}`, {
            method: 'GET',
            headers: {
              'Authorization': `token ${histApiKeyData.api_key}:${histSessionData.access_token}`,
              'X-Kite-Version': '3'
            }
          })

          if (!histResponse.ok) {
            const errorData = await histResponse.json()
            return Response.json({
              status: "error",
              message: errorData.message || "Failed to fetch historical data"
            }, { headers: corsHeaders })
          }

          const histData = await histResponse.json()
          const candles = histData.data.candles.map((candle: any) => ({
            timestamp: candle[0],
            open: candle[1],
            high: candle[2],
            low: candle[3],
            close: candle[4],
            volume: candle[5]
          }))

          // Apply comprehensive strategy
          const signal = analyzeComprehensiveStrategy(candles)
          signal.symbol = symbol

          await logActivity(supabaseClient, 'success', `Historical data fetched for ${symbol}. Signal: ${signal.action}`, symbol)
          
          return Response.json({
            status: "success",
            message: "Historical data fetched",
            data: {
              symbol: symbol,
              candles: candles,
              signal: signal,
              count: candles.length
            }
          }, { headers: corsHeaders })
        } catch (error) {
          await logActivity(supabaseClient, 'error', `Failed to fetch historical data for ${symbol}: ${error.message}`, symbol)
          return Response.json({
            status: "error",
            message: "Failed to fetch historical data: " + error.message
          }, { headers: corsHeaders })
        }
        break

      case '/execute_trade':
        const { symbol: tradeSymbol, action, quantity, order_type = 'MARKET' } = data
        
        const { data: tradeSessionData } = await supabaseClient
          .from('trading_sessions')
          .select('access_token')
          .eq('id', 1)
          .maybeSingle()

        const { data: tradeApiKeyData } = await supabaseClient
          .from('trading_credentials')
          .select('api_key')
          .eq('id', 1)
          .maybeSingle()

        if (!tradeSessionData?.access_token || !tradeApiKeyData?.api_key) {
          return Response.json({
            status: "error",
            message: "Not authenticated. Please login to Zerodha first."
          }, { headers: corsHeaders })
        }

        if (!tradeSymbol || !action || !quantity) {
          return Response.json({
            status: "error",
            message: "Symbol, action, and quantity are required"
          }, { headers: corsHeaders })
        }

        try {
          // Place real order via Zerodha API
          const orderResponse = await fetch(`${KITE_API_BASE}/orders/regular`, {
            method: 'POST',
            headers: {
              'Authorization': `token ${tradeApiKeyData.api_key}:${tradeSessionData.access_token}`,
              'X-Kite-Version': '3',
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              tradingsymbol: tradeSymbol,
              exchange: 'NSE',
              transaction_type: action,
              quantity: quantity.toString(),
              order_type: order_type,
              product: 'MIS', // Intraday
              validity: 'DAY'
            })
          })

          if (!orderResponse.ok) {
            const errorData = await orderResponse.json()
            return Response.json({
              status: "error",
              message: errorData.message || "Failed to place order"
            }, { headers: corsHeaders })
          }

          const orderData = await orderResponse.json()

          await logActivity(supabaseClient, 'success', `Order placed: ${action} ${quantity} ${tradeSymbol} - Order ID: ${orderData.data.order_id}`, tradeSymbol)
          return Response.json({
            status: "success",
            message: "Order placed successfully",
            data: {
              order_id: orderData.data.order_id,
              symbol: tradeSymbol,
              action: action,
              quantity: quantity
            }
          }, { headers: corsHeaders })
        } catch (error) {
          await logActivity(supabaseClient, 'error', `Failed to execute trade for ${tradeSymbol}: ${error.message}`, tradeSymbol)
          return Response.json({
            status: "error",
            message: "Failed to execute trade: " + error.message
          }, { headers: corsHeaders })
        }
        break

      case '/analyze_symbols':
        const { symbols: analyzeSymbols } = data
        
        if (!analyzeSymbols || !Array.isArray(analyzeSymbols)) {
          return Response.json({
            status: "error",
            message: "Symbols array is required"
          }, { headers: corsHeaders })
        }

        await logActivity(supabaseClient, 'info', `Starting comprehensive strategy analysis for ${analyzeSymbols.length} symbols`)

        // Get session data for API calls
        const { data: analysisSessionData } = await supabaseClient
          .from('trading_sessions')
          .select('access_token')
          .eq('id', 1)
          .maybeSingle()

        const { data: analysisApiKeyData } = await supabaseClient
          .from('trading_credentials')
          .select('api_key')
          .eq('id', 1)
          .maybeSingle()

        if (!analysisSessionData?.access_token || !analysisApiKeyData?.api_key) {
          return Response.json({
            status: "error",
            message: "Not authenticated. Please login to Zerodha first."
          }, { headers: corsHeaders })
        }

        const signals = []
        
        for (const symbol of analyzeSymbols) {
          try {
            await logActivity(supabaseClient, 'info', `Analyzing ${symbol.symbol} using comprehensive strategy`, symbol.symbol)

            // Get historical data from Zerodha API
            const fromDate = new Date()
            fromDate.setDate(fromDate.getDate() - 60) // 60 days of data for SMA50
            
            const histResponse = await fetch(`${KITE_API_BASE}/instruments/historical/${symbol.instrument_token}/3minute?from=${fromDate.toISOString().split('T')[0]}&to=${new Date().toISOString().split('T')[0]}`, {
              method: 'GET',
              headers: {
                'Authorization': `token ${analysisApiKeyData.api_key}:${analysisSessionData.access_token}`,
                'X-Kite-Version': '3'
              }
            })

            if (!histResponse.ok) {
              await logActivity(supabaseClient, 'warning', `Failed to get historical data for ${symbol.symbol}`, symbol.symbol)
              continue
            }

            const histData = await histResponse.json()
            const candles = histData.data.candles.map((candle: any) => ({
              timestamp: candle[0],
              open: candle[1],
              high: candle[2],
              low: candle[3],
              close: candle[4],
              volume: candle[5]
            }))

            // Apply comprehensive strategy logic
            const signal = analyzeComprehensiveStrategy(candles)
            signal.symbol = symbol.symbol
            
            if (signal.action !== 'HOLD') {
              await logActivity(supabaseClient, 'success', `COMPREHENSIVE STRATEGY SIGNAL: ${symbol.symbol} ${signal.action} at ₹${signal.price}. Reason: ${signal.reason}`, symbol.symbol)
            } else {
              await logActivity(supabaseClient, 'info', `No trading signal for ${symbol.symbol}: ${signal.reason}`, symbol.symbol)
            }
            
            signals.push({
              ...signal,
              symbol: symbol.symbol
            })

          } catch (error) {
            await logActivity(supabaseClient, 'error', `Failed to analyze ${symbol.symbol}: ${error.message}`, symbol.symbol)
            console.warn(`Failed to analyze ${symbol.symbol}:`, error)
          }
        }

        await logActivity(supabaseClient, 'success', `Comprehensive strategy analysis completed. Generated ${signals.filter(s => s.action !== 'HOLD').length} trading signals out of ${signals.length} symbols analyzed`)

        return Response.json({
          status: "success",
          message: "Symbols analyzed using comprehensive strategy",
          data: {
            signals: signals,
            timestamp: new Date().toISOString(),
            analyzed_count: signals.length
          }
        }, { headers: corsHeaders })
        break

      case '/place_test_order':
        const { data: testSessionData } = await supabaseClient
          .from('trading_sessions')
          .select('access_token')
          .eq('id', 1)
          .maybeSingle()

        const { data: testApiKeyData } = await supabaseClient
          .from('trading_credentials')
          .select('api_key')
          .eq('id', 1)
          .maybeSingle()

        if (!testSessionData?.access_token || !testApiKeyData?.api_key) {
          return Response.json({
            status: "error",
            message: "Not authenticated. Please login to Zerodha first."
          }, { headers: corsHeaders })
        }

        try {
          // Instead of placing an order, just test API connectivity by fetching orders
          const ordersResponse = await fetch(`${KITE_API_BASE}/orders`, {
            method: 'GET',
            headers: {
              'Authorization': `token ${testApiKeyData.api_key}:${testSessionData.access_token}`,
              'X-Kite-Version': '3'
            }
          })

          if (!ordersResponse.ok) {
            const errorData = await ordersResponse.json()
            return Response.json({
              status: "error",
              message: "API connection test failed: " + (errorData.message || "Unknown error")
            }, { headers: corsHeaders })
          }

          // API connection successful
          await logActivity(supabaseClient, 'success', 'API connection test successful - Zerodha API is working correctly')
          return Response.json({
            status: "success",
            message: "API connection test successful",
            data: {
              order_id: "test_" + Date.now(),
              symbol: "API_TEST",
              message: "Zerodha API is working correctly"
            }
          }, { headers: corsHeaders })
        } catch (error) {
          await logActivity(supabaseClient, 'error', `API connection test failed: ${error.message}`)
          return Response.json({
            status: "error",
            message: "API connection test failed: " + error.message
          }, { headers: corsHeaders })
        }
        break

      case '/test_connection':
        const { data: sessionData } = await supabaseClient
          .from('trading_sessions')
          .select('*')
          .eq('id', 1)
          .maybeSingle()

        if (sessionData && sessionData.access_token && sessionData.status === 'authenticated') {
          return Response.json({
            status: "connected",
            message: "Connected to Zerodha",
            data: {
              user_id: sessionData.user_id,
              user_name: sessionData.user_name
            }
          }, { headers: corsHeaders })
        } else {
          return Response.json({
            status: "disconnected",
            message: "Not connected to broker"
          }, { headers: corsHeaders })
        }
        break

      case '/live_status':
        try {
          // Get latest trading logs
          const { data: logsData } = await supabaseClient
            .from('trading_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50)

          // Get active trading session
          const { data: liveSessionData } = await supabaseClient
            .from('trading_sessions')
            .select('*')
            .eq('id', 1)
            .maybeSingle()

          // Get active positions
          const { data: positionsData } = await supabaseClient
            .from('trading_positions')
            .select('*')
            .eq('status', 'active')

          // Get balance data if authenticated
          let balanceData = null
          if (liveSessionData?.access_token) {
            try {
              const { data: apiKeyData } = await supabaseClient
                .from('trading_credentials')
                .select('api_key')
                .eq('id', 1)
                .maybeSingle()

              if (apiKeyData?.api_key) {
                const balanceResponse = await fetch(`${KITE_API_BASE}/user/margins`, {
                  method: 'GET',
                  headers: {
                    'Authorization': `token ${apiKeyData.api_key}:${liveSessionData.access_token}`,
                    'X-Kite-Version': '3'
                  }
                })

                if (balanceResponse.ok) {
                  const balanceResult = await balanceResponse.json()
                  balanceData = balanceResult.data
                }
              }
            } catch (error) {
              console.warn('Failed to fetch balance:', error)
            }
          }

          const liveStatus = {
            is_market_open: true,
            live_trading_active: liveSessionData?.trading_active || false,
            selected_symbols: liveSessionData?.symbols || [],
            active_positions: positionsData || [],
            strategy_logs: logsData || [],
            balance: balanceData,
            last_updated: new Date().toISOString()
          }

          return Response.json({
            status: "success",
            message: "Live status retrieved",
            data: { live_status: liveStatus }
          }, { headers: corsHeaders })
        } catch (error) {
          console.error('Live status error:', error)
          return Response.json({
            status: "error",
            message: "Failed to get live status: " + error.message
          }, { headers: corsHeaders })
        }
        break

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