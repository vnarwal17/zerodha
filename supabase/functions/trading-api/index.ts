import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crypto } from "https://deno.land/std@0.192.0/crypto/mod.ts"

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
  
  // Long setup: entire candle strictly above SMA
  if (low > sma50 && high > sma50 && open > sma50 && close > sma50) {
    return { isValid: true, bias: 'LONG' };
  }
  
  // Short setup: entire candle strictly below SMA
  if (low < sma50 && high < sma50 && open < sma50 && close < sma50) {
    return { isValid: true, bias: 'SHORT' };
  }
  
  // Invalid if any part touches SMA
  return { isValid: false, bias: 'INVALID' };
}

function isValidRejectionCandle(candle: CandleData, sma50: number, bias: 'LONG' | 'SHORT'): boolean {
  const { open, high, low, close } = candle;
  const candleRange = high - low;
  
  if (bias === 'LONG') {
    // Lower wick must touch SMA, body and close above SMA
    const wickTouchesSMA = low <= sma50 && sma50 <= high;
    const bodyAboveSMA = Math.min(open, close) > sma50;
    const wickSize = Math.min(open, close) - low;
    const wickPercentage = (wickSize / candleRange) * 100;
    
    return wickTouchesSMA && bodyAboveSMA && wickPercentage >= 15;
  } else if (bias === 'SHORT') {
    // Upper wick must touch SMA, body and close below SMA
    const wickTouchesSMA = low <= sma50 && sma50 <= high;
    const bodyBelowSMA = Math.max(open, close) < sma50;
    const wickSize = high - Math.max(open, close);
    const wickPercentage = (wickSize / candleRange) * 100;
    
    return wickTouchesSMA && bodyBelowSMA && wickPercentage >= 15;
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

  // Check 10 AM setup validity
  const setupResult = isValidSetupCandle(setupCandle, sma50);
  
  if (!setupResult.isValid) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'Invalid 10 AM setup - candle touches SMA or straddles it'
    };
  }

  // Look for rejection candle after setup
  let rejectionCandle: CandleData | null = null;
  let rejectionIndex = -1;
  
  // Search for rejection candle in subsequent candles
  for (let i = setupCandleIndex + 1; i < candles.length; i++) {
    const candidate = candles[i];
    
    // Check if any candle fully crosses SMA (invalidates day)
    if ((candidate.low <= sma50 && candidate.high >= sma50) && 
        !isValidRejectionCandle(candidate, sma50, setupResult.bias)) {
      return {
        symbol: '',
        action: 'HOLD',
        price: 0,
        quantity: 0,
        reason: 'Day invalidated - candle crossed SMA without valid rejection'
      };
    }
    
    if (isValidRejectionCandle(candidate, sma50, setupResult.bias)) {
      rejectionCandle = candidate;
      rejectionIndex = i;
      break;
    }
  }
  
  if (!rejectionCandle) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'No valid rejection candle found yet'
    };
  }

  // Check if we're past the 2-candle skip period
  const candlesAfterRejection = candles.length - 1 - rejectionIndex;
  if (candlesAfterRejection < 2) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'In 2-candle skip period after rejection'
    };
  }

  // Calculate entry and stop loss based on rejection candle
  const currentPrice = candles[candles.length - 1].close;
  
  if (setupResult.bias === 'LONG') {
    const entryPrice = rejectionCandle.high + 0.10;
    const stopLoss = rejectionCandle.low - 0.15;
    const risk = entryPrice - stopLoss;
    const target = entryPrice + (risk * 5); // 5:1 RR
    
    // Check if current price triggers entry
    if (currentPrice >= entryPrice) {
      return {
        symbol: '',
        action: 'BUY',
        price: entryPrice,
        quantity: 1,
        reason: `LONG entry triggered. Entry: ${entryPrice.toFixed(2)}, SL: ${stopLoss.toFixed(2)}, Target: ${target.toFixed(2)} (5R)`
      };
    } else {
      return {
        symbol: '',
        action: 'HOLD',
        price: currentPrice,
        quantity: 0,
        reason: `LONG setup ready. Waiting for price ${entryPrice.toFixed(2)} (Current: ${currentPrice.toFixed(2)})`
      };
    }
  } else if (setupResult.bias === 'SHORT') {
    const entryPrice = rejectionCandle.low - 0.10;
    const stopLoss = rejectionCandle.high + 0.15;
    const risk = stopLoss - entryPrice;
    const target = entryPrice - (risk * 5); // 5:1 RR
    
    // Check if current price triggers entry
    if (currentPrice <= entryPrice) {
      return {
        symbol: '',
        action: 'SELL',
        price: entryPrice,
        quantity: 1,
        reason: `SHORT entry triggered. Entry: ${entryPrice.toFixed(2)}, SL: ${stopLoss.toFixed(2)}, Target: ${target.toFixed(2)} (5R)`
      };
    } else {
      return {
        symbol: '',
        action: 'HOLD',
        price: currentPrice,
        quantity: 0,
        reason: `SHORT setup ready. Waiting for price ${entryPrice.toFixed(2)} (Current: ${currentPrice.toFixed(2)})`
      };
    }
  }

  return {
    symbol: '',
    action: 'HOLD',
    price: currentPrice,
    quantity: 0,
    reason: 'No valid signal generated'
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { path, ...requestData } = await req.json()
    
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    )

    switch (path) {
      case '/set_credentials':
        const { api_key, api_secret } = requestData
          
          if (!api_key || !api_secret) {
            return Response.json({
              status: "error",
              message: "Both API key and secret are required"
            }, { headers: corsHeaders })
          }

          // Store credentials securely in Supabase
          const { error: credentialsError } = await supabaseClient
            .from('trading_credentials')
            .upsert({
              id: 1,
              api_key,
              api_secret,
              updated_at: new Date().toISOString()
            })

          if (credentialsError) {
            return Response.json({
              status: "error",
              message: credentialsError.message
            }, { headers: corsHeaders })
          }

          return Response.json({
            status: "success",
            message: "Credentials updated successfully"
          }, { headers: corsHeaders })
        break

      case '/login':
        const { request_token } = requestData
        
        if (request_token) {
          // Get stored credentials
          const { data: credentialsData } = await supabaseClient
            .from('trading_credentials')
            .select('*')
            .eq('id', 1)
            .maybeSingle()

          if (!credentialsData) {
            return Response.json({
              status: "error",
              message: "API credentials not found. Please set up credentials first."
            }, { headers: corsHeaders })
          }

          // Calculate checksum: SHA-256 of api_key + request_token + api_secret
          const checksum_string = credentialsData.api_key + request_token + credentialsData.api_secret
          const encoder = new TextEncoder()
          const data = encoder.encode(checksum_string)
          const hashBuffer = await crypto.subtle.digest('SHA-256', data)
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

            const tokenData = await tokenResponse.json()

            if (tokenResponse.ok && tokenData.status === 'success') {
              // Store access token and user data
              const { error: sessionError } = await supabaseClient
                .from('trading_sessions')
                .upsert({
                  id: 1,
                  access_token: tokenData.data.access_token,
                  user_id: tokenData.data.user_id,
                  user_name: tokenData.data.user_name,
                  status: 'authenticated',
                  login_time: tokenData.data.login_time,
                  updated_at: new Date().toISOString()
                })

              if (sessionError) {
                return Response.json({
                  status: "error",
                  message: sessionError.message
                }, { headers: corsHeaders })
              }

              return Response.json({
                status: "success",
                message: "Login successful",
                data: { 
                  user_id: tokenData.data.user_id,
                  user_name: tokenData.data.user_name
                }
              }, { headers: corsHeaders })
            } else {
              return Response.json({
                status: "error",
                message: tokenData.message || "Authentication failed"
              }, { headers: corsHeaders })
            }
          } catch (error) {
            return Response.json({
              status: "error",
              message: "Failed to authenticate with Zerodha API"
            }, { headers: corsHeaders })
          }
        } else {
          // Get API key for login URL
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

          const login_url = `https://kite.zerodha.com/connect/login?v=3&api_key=${credentialsData.api_key}`
          return Response.json({
            status: "requires_login",
            message: "Please complete login",
            data: { login_url }
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

      case '/instruments':
        const { data: instrumentsSessionData } = await supabaseClient
          .from('trading_sessions')
          .select('access_token')
          .eq('id', 1)
          .maybeSingle()

        const { data: instrumentsApiKeyData } = await supabaseClient
          .from('trading_credentials')
          .select('api_key')
          .eq('id', 1)
          .maybeSingle()

        // Define comprehensive stock lists
        const nifty50Stocks = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "HINDUNILVR", "HDFC", "ICICIBANK", "KOTAKBANK", "BHARTIARTL", "ITC", "SBIN", "BAJFINANCE", "ASIANPAINT", "MARUTI", "HCLTECH", "AXISBANK", "LT", "DMART", "SUNPHARMA", "TITAN", "ULTRACEMCO", "NESTLEIND", "WIPRO", "NTPC", "JSWSTEEL", "TECHM", "TATAMOTORS", "INDUSINDBK", "POWERGRID", "BAJAJFINSV", "GRASIM", "ADANIENT", "COALINDIA", "HEROMOTOCO", "CIPLA", "EICHERMOT", "BRITANNIA", "DIVISLAB", "DRREDDY", "APOLLOHOSP", "TATACONSUM", "UPL", "BAJAJ-AUTO", "HINDALCO", "ONGC", "SBILIFE", "BPCL", "TATASTEEL", "HDFCLIFE", "ADANIPORTS"]
        const bankniftyStocks = ["HDFCBANK", "ICICIBANK", "KOTAKBANK", "SBIN", "AXISBANK", "INDUSINDBK", "BAJFINANCE", "BAJAJFINSV", "PNB", "BANKBARODA", "AUBANK", "IDFCFIRSTB"]
        
        // Create instruments from the stock lists
        const createInstrument = (symbol: string, baseToken: number) => ({
          symbol: symbol,
          instrument_token: baseToken,
          exchange: "NSE",
          name: symbol + " Ltd.",
          is_nifty50: nifty50Stocks.includes(symbol),
          is_banknifty: bankniftyStocks.includes(symbol)
        })

        let instruments = []

        if (instrumentsSessionData?.access_token && instrumentsApiKeyData?.api_key) {
          try {
            // Try to fetch real instruments from Zerodha API
            const instrumentsResponse = await fetch(`${KITE_API_BASE}/instruments`, {
              method: 'GET',
              headers: {
                'Authorization': `token ${instrumentsApiKeyData.api_key}:${instrumentsSessionData.access_token}`,
                'X-Kite-Version': '3'
              }
            })

            console.log('Instruments API response status:', instrumentsResponse.status)

            if (instrumentsResponse.ok) {
              const instrumentsText = await instrumentsResponse.text()
              console.log('Instruments data length:', instrumentsText.length)
              
              if (instrumentsText.length > 100) { // Check if we got actual data
                const lines = instrumentsText.split('\n')
                console.log('Number of lines:', lines.length)
                
                // Parse CSV data - Include all NSE equity instruments
                for (let i = 1; i < lines.length; i++) {
                  const cols = lines[i].split(',')
                  if (cols.length >= 8) {
                    const symbol = cols[2]?.replace(/"/g, '')
                    const exchange = cols[11]?.replace(/"/g, '')
                    const instrumentType = cols[9]?.replace(/"/g, '')
                    
                    // Include all NSE equity instruments (stocks)
                    if (exchange === 'NSE' && instrumentType === 'EQ' && symbol && symbol.length > 0) {
                      instruments.push({
                        symbol: symbol,
                        instrument_token: parseInt(cols[0]) || 0,
                        exchange: exchange,
                        name: cols[1]?.replace(/"/g, '') || symbol + " Ltd.",
                        is_nifty50: nifty50Stocks.includes(symbol),
                        is_banknifty: bankniftyStocks.includes(symbol)
                      })
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.error('Error fetching instruments:', error)
          }
        }

        // If no instruments from API, create from predefined lists
        if (instruments.length === 0) {
          console.log('Using fallback instruments')
          let tokenBase = 100000
          
          // Add all Nifty 50 stocks
          nifty50Stocks.forEach((symbol, index) => {
            instruments.push(createInstrument(symbol, tokenBase + index))
          })
          
          // Add additional Bank Nifty stocks not in Nifty 50
          bankniftyStocks.forEach((symbol, index) => {
            if (!nifty50Stocks.includes(symbol)) {
              instruments.push(createInstrument(symbol, tokenBase + 50 + index))
            }
          })
        }

        console.log('Final instruments count:', instruments.length)

        return Response.json({
          status: "success",
          data: {
            instruments: instruments,
            nifty50_stocks: nifty50Stocks,
            banknifty_stocks: bankniftyStocks,
            count: instruments.length
          }
        }, { headers: corsHeaders })
        break

      case '/start_live_trading':
        const { symbols } = requestData
          
          // Store trading session
          const { error: tradingError } = await supabaseClient
            .from('trading_sessions')
            .upsert({
              id: 1,
              trading_active: true,
              symbols: symbols,
              updated_at: new Date().toISOString()
            })

          if (tradingError) {
            return Response.json({
              status: "error",
              message: tradingError.message
            }, { headers: corsHeaders })
          }

          return Response.json({
            status: "success",
            message: `Started live trading for ${symbols.length} symbols`,
            data: { symbols: symbols.map((s: TradingSymbol) => s.symbol) }
          }, { headers: corsHeaders })
        break

      case '/stop_live_trading':
          const { error: stopError } = await supabaseClient
            .from('trading_sessions')
            .upsert({
              id: 1,
              trading_active: false,
              updated_at: new Date().toISOString()
            })

          if (stopError) {
            return Response.json({
              status: "error",
              message: stopError.message
            }, { headers: corsHeaders })
          }

          return Response.json({
            status: "success",
            message: "Live trading stopped"
          }, { headers: corsHeaders })
        break

      case '/live_status':
        const { data: statusData } = await supabaseClient
          .from('trading_sessions')
          .select('*')
          .eq('id', 1)
          .maybeSingle()

          return Response.json({
            status: "success",
            data: {
              live_status: {
                is_trading: statusData?.trading_active || false,
                market_open: true,
                active_positions: [],
                logs: [
                  { timestamp: new Date().toISOString(), message: "Trading system initialized" }
                ]
              }
            }
          }, { headers: corsHeaders })
        break

      case '/update_settings':
        const settings = requestData
          
          const { error: settingsError } = await supabaseClient
            .from('trading_settings')
            .upsert({
              id: 1,
              settings: settings,
              updated_at: new Date().toISOString()
            })

          if (settingsError) {
            return Response.json({
              status: "error",
              message: settingsError.message
            }, { headers: corsHeaders })
          }

          return Response.json({
            status: "success",
            message: "Settings updated successfully"
          }, { headers: corsHeaders })
        break

      case '/get_balance':
        const { data: balanceSessionData } = await supabaseClient
          .from('trading_sessions')
          .select('access_token, user_id')
          .eq('id', 1)
          .maybeSingle()

        if (!balanceSessionData?.access_token) {
          return Response.json({
            status: "error",
            message: "Not authenticated. Please login first."
          }, { headers: corsHeaders })
        }

        // Get API key for proper authorization format
        const { data: apiKeyData } = await supabaseClient
          .from('trading_credentials')
          .select('api_key')
          .eq('id', 1)
          .maybeSingle()

        if (!apiKeyData?.api_key) {
          return Response.json({
            status: "error",
            message: "API credentials not found."
          }, { headers: corsHeaders })
        }

        try {
          // Fetch funds from Zerodha API with correct authorization format
          const fundsResponse = await fetch(`${KITE_API_BASE}/user/margins`, {
            method: 'GET',
            headers: {
              'Authorization': `token ${apiKeyData.api_key}:${balanceSessionData.access_token}`,
              'X-Kite-Version': '3'
            }
          })

          const fundsData = await fundsResponse.json()

          if (fundsResponse.ok && fundsData.status === 'success') {
            return Response.json({
              status: "success",
              data: {
                balance: fundsData.data,
                user_id: balanceSessionData.user_id
              }
            }, { headers: corsHeaders })
          } else {
            return Response.json({
              status: "error",
              message: fundsData.message || "Failed to fetch balance"
            }, { headers: corsHeaders })
          }
        } catch (error) {
          return Response.json({
            status: "error",
            message: "Failed to fetch balance from Zerodha API"
          }, { headers: corsHeaders })
        }
        break

      case '/get_historical_data':
        const { symbol, instrument_token, interval = '3minute', days = 30 } = requestData
        
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
            message: "Not authenticated. Please login first."
          }, { headers: corsHeaders })
        }

        try {
          const toDate = new Date()
          const fromDate = new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000)
          
          const histResponse = await fetch(
            `${KITE_API_BASE}/instruments/historical/${instrument_token}/${interval}?from=${fromDate.toISOString().split('T')[0]}&to=${toDate.toISOString().split('T')[0]}`,
            {
              method: 'GET',
              headers: {
                'Authorization': `token ${histApiKeyData.api_key}:${histSessionData.access_token}`,
                'X-Kite-Version': '3'
              }
            }
          )

          const histData = await histResponse.json()

          if (histResponse.ok && histData.status === 'success') {
            const candles: CandleData[] = histData.data.candles.map((candle: any[]) => ({
              timestamp: candle[0],
              open: candle[1],
              high: candle[2],
              low: candle[3],
              close: candle[4],
              volume: candle[5]
            }))

            // Analyze strategy for this symbol
            const signal = analyzeIntradayStrategy(candles)
            signal.symbol = symbol

            return Response.json({
              status: "success",
              data: {
                symbol,
                candles,
                signal,
                count: candles.length
              }
            }, { headers: corsHeaders })
          } else {
            return Response.json({
              status: "error",
              message: histData.message || "Failed to fetch historical data"
            }, { headers: corsHeaders })
          }
        } catch (error) {
          return Response.json({
            status: "error",
            message: "Failed to fetch historical data from Zerodha API"
          }, { headers: corsHeaders })
        }
        break

      case '/execute_trade':
        const { trade_symbol, action, quantity, order_type = 'MARKET' } = requestData
        
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

        // Get trading settings
        const { data: settingsData } = await supabaseClient
          .from('trading_settings')
          .select('settings')
          .eq('id', 1)
          .maybeSingle()

        if (!tradeSessionData?.access_token || !tradeApiKeyData?.api_key) {
          return Response.json({
            status: "error",
            message: "Not authenticated. Please login first."
          }, { headers: corsHeaders })
        }

        try {
          // Default settings if none are saved
          const settings = settingsData?.settings || {
            product: 'MIS',
            validity: 'DAY', 
            market_protection: -1,
            tag: 'ALGO_TRADE'
          };

          // Build order parameters according to Zerodha API spec
          const orderParams = new URLSearchParams({
            tradingsymbol: trade_symbol,
            exchange: 'NSE',
            transaction_type: action, // BUY or SELL
            order_type: order_type, // MARKET, LIMIT, etc.
            quantity: quantity.toString(),
            product: settings.product, // MIS, CNC, NRML
            validity: settings.validity, // DAY, IOC, TTL
            market_protection: settings.market_protection.toString(),
            tag: settings.tag || 'ALGO_TRADE'
          });

          // Add optional parameters if they exist
          if (settings.disclosed_quantity && settings.disclosed_quantity > 0) {
            orderParams.append('disclosed_quantity', settings.disclosed_quantity.toString());
          }

          console.log('Placing order with params:', Object.fromEntries(orderParams));

          const orderResponse = await fetch(`${KITE_API_BASE}/orders/regular`, {
            method: 'POST',
            headers: {
              'Authorization': `token ${tradeApiKeyData.api_key}:${tradeSessionData.access_token}`,
              'X-Kite-Version': '3',
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: orderParams
          })

          const orderData = await orderResponse.json()

          if (orderResponse.ok && orderData.status === 'success') {
            // Log the trade in database
            await supabaseClient
              .from('trade_logs')
              .insert({
                symbol: trade_symbol,
                action: action,
                quantity: quantity,
                order_id: orderData.data.order_id,
                order_type: order_type,
                status: 'PLACED',
                timestamp: new Date().toISOString()
              })

            return Response.json({
              status: "success",
              message: `${action} order placed successfully`,
              data: {
                order_id: orderData.data.order_id,
                symbol: trade_symbol,
                action: action,
                quantity: quantity
              }
            }, { headers: corsHeaders })
          } else {
            return Response.json({
              status: "error",
              message: orderData.message || "Failed to place order"
            }, { headers: corsHeaders })
          }
        } catch (error) {
          return Response.json({
            status: "error",
            message: "Failed to execute trade"
          }, { headers: corsHeaders })
        }
        break

      case '/analyze_symbols':
        const { monitoring_symbols } = requestData
        
        const { data: analyzeSessionData } = await supabaseClient
          .from('trading_sessions')
          .select('access_token')
          .eq('id', 1)
          .maybeSingle()

        const { data: analyzeApiKeyData } = await supabaseClient
          .from('trading_credentials')
          .select('api_key')
          .eq('id', 1)
          .maybeSingle()

        if (!analyzeSessionData?.access_token || !analyzeApiKeyData?.api_key) {
          return Response.json({
            status: "error",
            message: "Not authenticated. Please login first."
          }, { headers: corsHeaders })
        }

        const signals = []
        
        for (const sym of monitoring_symbols) {
          try {
            const toDate = new Date()
            const fromDate = new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000)
            
            const histResponse = await fetch(
              `${KITE_API_BASE}/instruments/historical/${sym.instrument_token}/3minute?from=${fromDate.toISOString().split('T')[0]}&to=${toDate.toISOString().split('T')[0]}`,
              {
                method: 'GET',
                headers: {
                  'Authorization': `token ${analyzeApiKeyData.api_key}:${analyzeSessionData.access_token}`,
                  'X-Kite-Version': '3'
                }
              }
            )

            if (histResponse.ok) {
              const histData = await histResponse.json()
              if (histData.status === 'success' && histData.data.candles) {
                const candles: CandleData[] = histData.data.candles.map((candle: any[]) => ({
                  timestamp: candle[0],
                  open: candle[1],
                  high: candle[2],
                  low: candle[3],
                  close: candle[4],
                  volume: candle[5]
                }))

                const signal = analyzeIntradayStrategy(candles)
                signal.symbol = sym.symbol
                signals.push(signal)
              }
            }
          } catch (error) {
            console.error(`Error analyzing ${sym.symbol}:`, error)
          }
        }

        return Response.json({
          status: "success",
          data: {
            signals,
            timestamp: new Date().toISOString(),
            analyzed_count: signals.length
          }
        }, { headers: corsHeaders })
        break

      default:
        return Response.json({
          status: "error",
          message: "Endpoint not found"
        }, { status: 404, headers: corsHeaders })
    }

  } catch (error) {
    return Response.json({
      status: "error",
      message: error.message
    }, { status: 500, headers: corsHeaders })
  }
})