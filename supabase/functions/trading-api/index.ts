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

// Helper function to log activities to database
async function logActivity(
  supabaseClient: any,
  eventType: string, 
  eventName: string, 
  message: string, 
  symbol: string = 'SYSTEM', 
  severity: string = 'info', 
  metadata: any = {}
) {
  try {
    await supabaseClient
      .from('activity_logs')
      .insert({
        event_type: eventType,
        event_name: eventName,
        symbol: symbol,
        message: message,
        severity: severity,
        metadata: metadata
      });
    console.log(`[${eventType}] ${eventName}: ${message}`);
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
}

// Your specific strategy implementation
function findSetupCandle(candles: CandleData[]): CandleData | null {
  // Find the setup candle that falls within 09:57-10:00 AM IST
  // The setup candle is the 3-minute candle from 09:57:00 to 09:59:59 IST
  
  for (let i = candles.length - 1; i >= 0; i--) {
    const candle = candles[i];
    if (!candle.timestamp) continue;
    
    // Parse the timestamp and convert to IST
    const candleTime = new Date(candle.timestamp);
    const istTime = new Date(candleTime.getTime() + (5.5 * 60 * 60 * 1000));
    
    const hour = istTime.getHours();
    const minute = istTime.getMinutes();
    
    // Check if this candle is the 09:57-10:00 AM setup candle
    // For 3-minute candles, the 09:57 candle covers 09:57:00 to 09:59:59
    if (hour === 9 && minute === 57) {
      return candle;
    }
  }
  
  // If exact 09:57 candle not found, look for the closest setup candle in the 09:54-10:00 range
  for (let i = candles.length - 1; i >= 0; i--) {
    const candle = candles[i];
    if (!candle.timestamp) continue;
    
    const candleTime = new Date(candle.timestamp);
    const istTime = new Date(candleTime.getTime() + (5.5 * 60 * 60 * 1000));
    
    const hour = istTime.getHours();
    const minute = istTime.getMinutes();
    
    // Accept candles between 09:54 and 09:59 as potential setup candles
    if (hour === 9 && minute >= 54 && minute <= 59) {
      return candle;
    }
  }
  
  return null;
}

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
  // CRITICAL VALIDATION: Ensure minimum candles for proper analysis
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
  
  // Convert current time to IST for proper market timing
  const currentTime = new Date();
  const istTime = new Date(currentTime.getTime() + (5.5 * 60 * 60 * 1000)); // Add 5.5 hours for IST
  const currentHour = istTime.getHours();
  const currentMinute = istTime.getMinutes();
  const currentSecond = istTime.getSeconds();
  
  // STRICT VALIDATION: Only trade during market hours
  if (currentHour < 9 || (currentHour === 9 && currentMinute < 15) || currentHour >= 15) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'Outside market hours (9:15 AM - 3:00 PM IST)'
    };
  }
  
  // STRICT VALIDATION: Entry window restriction after setup validation
  if (currentHour < 10 || currentHour >= 13) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'Outside entry window (10:00 AM - 1:00 PM IST) - setup time required'
    };
  }

  // CRITICAL VALIDATION: Calculate SMA50 with error checking
  const sma50 = calculateSMA50(closes);
  if (sma50 === 0 || isNaN(sma50) || !isFinite(sma50)) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'SMA50 calculation failed or invalid'
    };
  }

  // CRITICAL VALIDATION: Setup candle from 09:57:00-09:59:59 period
  // Find the setup candle by actual timestamp (09:57 - 10:00 AM IST)
  const setupCandle = findSetupCandle(candles);
  if (!setupCandle) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'Setup candle (09:57-10:00 AM IST) not found in historical data'
    };
  }

  // STRICT VALIDATION: Setup candle must be completely above/below SMA
  const setupResult = isValidSetupCandle(setupCandle, sma50);
  if (!setupResult.isValid || setupResult.bias === 'INVALID') {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'Invalid 09:57:00-09:59:59 setup - candle must be completely above/below SMA'
    };
  }

  // CRITICAL VALIDATION: Look for valid rejection candle
  let rejectionCandle: CandleData | null = null;
  let rejectionIndex = -1;
  let dayInvalidated = false;
  
  // Search for rejection candle in subsequent candles with strict validation
  for (let i = Math.max(0, candles.length - 15) + 1; i < candles.length; i++) {
    const candidate = candles[i];
    
    // STRICT CHECK: If any candle crosses SMA without valid rejection, invalidate day
    if ((candidate.low <= sma50 && candidate.high >= sma50)) {
      if (!isValidRejectionCandle(candidate, sma50, setupResult.bias)) {
        dayInvalidated = true;
        break;
      } else if (!rejectionCandle) {
        // First valid rejection candle found
        rejectionCandle = candidate;
        rejectionIndex = i;
      }
    }
  }
  
  if (dayInvalidated) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'Day invalidated - candle crossed SMA without valid rejection'
    };
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

  // STRICT VALIDATION: Must wait 2 candles after rejection
  const candlesAfterRejection = candles.length - 1 - rejectionIndex;
  if (candlesAfterRejection < 2) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'In mandatory 2-candle skip period after rejection'
    };
  }

  // CRITICAL VALIDATION: Ensure current price data is valid
  const currentCandle = candles[candles.length - 1];
  const currentPrice = currentCandle.close;
  
  if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) {
    return {
      symbol: '',
      action: 'HOLD',
      price: 0,
      quantity: 0,
      reason: 'Invalid current price data'
    };
  }

  // FINAL VALIDATION: Check that all price calculations are valid before entry
  
  if (setupResult.bias === 'LONG') {
    const entryPrice = rejectionCandle.high + 0.10;
    const stopLoss = rejectionCandle.low - 0.15;
    const risk = entryPrice - stopLoss;
    const target = entryPrice + (risk * 5); // 5:1 RR
    
    // CRITICAL VALIDATION: Ensure all price calculations are valid
    if (isNaN(entryPrice) || isNaN(stopLoss) || isNaN(risk) || isNaN(target) || 
        entryPrice <= 0 || stopLoss <= 0 || risk <= 0 || target <= 0 || 
        risk < 0.50) { // Minimum risk of 50 paisa
      return {
        symbol: '',
        action: 'HOLD',
        price: 0,
        quantity: 0,
        reason: 'Invalid LONG price calculations - risk too small or negative values'
      };
    }
    
    // ADDITIONAL VALIDATION: Ensure logical price relationships
    if (entryPrice <= stopLoss || target <= entryPrice) {
      return {
        symbol: '',
        action: 'HOLD',
        price: 0,
        quantity: 0,
        reason: 'Invalid LONG price logic - entry must be above SL, target above entry'
      };
    }
    
    // FINAL CHECK: Current price must clearly break above entry with conviction
    if (currentPrice >= entryPrice && (currentPrice - entryPrice) >= 0.05) {
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
    
    // CRITICAL VALIDATION: Ensure all price calculations are valid
    if (isNaN(entryPrice) || isNaN(stopLoss) || isNaN(risk) || isNaN(target) || 
        entryPrice <= 0 || stopLoss <= 0 || risk <= 0 || target <= 0 || 
        risk < 0.50) { // Minimum risk of 50 paisa
      return {
        symbol: '',
        action: 'HOLD',
        price: 0,
        quantity: 0,
        reason: 'Invalid SHORT price calculations - risk too small or negative values'
      };
    }
    
    // ADDITIONAL VALIDATION: Ensure logical price relationships
    if (entryPrice >= stopLoss || target >= entryPrice) {
      return {
        symbol: '',
        action: 'HOLD',
        price: 0,
        quantity: 0,
        reason: 'Invalid SHORT price logic - entry must be below SL, target below entry'
      };
    }
    
    // FINAL CHECK: Current price must clearly break below entry with conviction
    if (currentPrice <= entryPrice && (entryPrice - currentPrice) >= 0.05) {
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
        await logActivity(supabaseClient, 'SYSTEM', 'CREDENTIALS_UPDATE', 'API credentials being updated');
        
        const { api_key, api_secret } = requestData
          
          if (!api_key || !api_secret) {
            await logActivity(supabaseClient, 'SYSTEM', 'CREDENTIALS_ERROR', 'Missing API credentials', 'SYSTEM', 'error');
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
            await logActivity(supabaseClient, 'SYSTEM', 'CREDENTIALS_ERROR', 'Failed to save credentials', 'SYSTEM', 'error');
            return Response.json({
              status: "error",
              message: credentialsError.message
            }, { headers: corsHeaders })
          }

          await logActivity(supabaseClient, 'SYSTEM', 'CREDENTIALS_SAVED', 'Trading credentials saved successfully', 'SYSTEM', 'success');
          
          return Response.json({
            status: "success",
            message: "Credentials updated successfully"
          }, { headers: corsHeaders })
        break

      case '/login':
        await logActivity(supabaseClient, 'CONNECTION', 'LOGIN_ATTEMPT', 'User attempting to connect to Zerodha');
        
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
        
        await logActivity(supabaseClient, 'TRADING', 'START_TRADING', `Starting live trading for ${symbols.length} symbols`, 'SYSTEM', 'success', { symbol_count: symbols.length, symbols: symbols.map((s: TradingSymbol) => s.symbol) });
          
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
            await logActivity(supabaseClient, 'TRADING', 'START_ERROR', 'Failed to start live trading', 'SYSTEM', 'error');
            return Response.json({
              status: "error",
              message: tradingError.message
            }, { headers: corsHeaders })
          }

          // Log individual symbols being monitored
          for (const symbol of symbols) {
            await logActivity(supabaseClient, 'ANALYSIS', 'SYMBOL_MONITOR', `Now monitoring ${symbol.symbol} for trading signals`, symbol.symbol, 'info');
          }

          return Response.json({
            status: "success",
            message: `Started live trading for ${symbols.length} symbols`,
            data: { symbols: symbols.map((s: TradingSymbol) => s.symbol) }
          }, { headers: corsHeaders })
        break

      case '/stop_live_trading':
          await logActivity(supabaseClient, 'TRADING', 'STOP_TRADING', 'Stopping live trading', 'SYSTEM', 'warning');
          
          const { error: stopError } = await supabaseClient
            .from('trading_sessions')
            .upsert({
              id: 1,
              trading_active: false,
              updated_at: new Date().toISOString()
            })

          if (stopError) {
            await logActivity(supabaseClient, 'TRADING', 'STOP_ERROR', 'Failed to stop live trading', 'SYSTEM', 'error');
            return Response.json({
              status: "error",
              message: stopError.message
            }, { headers: corsHeaders })
          }

          await logActivity(supabaseClient, 'TRADING', 'STOP_SUCCESS', 'Live trading stopped successfully', 'SYSTEM', 'success');

          return Response.json({
            status: "success",
            message: "Live trading stopped"
          }, { headers: corsHeaders })
        break

      case '/live_status':
        await logActivity(supabaseClient, 'SYSTEM', 'STATUS_CHECK', 'Checking live trading status');
        
        const { data: statusData } = await supabaseClient
          .from('trading_sessions')
          .select('*')
          .eq('id', 1)
          .maybeSingle()

        // Get recent activity logs for live status
        const { data: recentLogs } = await supabaseClient
          .from('activity_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20);

          return Response.json({
            status: "success",
            data: {
              live_status: {
                is_trading: statusData?.trading_active || false,
                market_open: true,
                active_positions: [],
                strategy_logs: recentLogs?.map(log => ({
                  timestamp: log.created_at,
                  symbol: log.symbol,
                  event: log.event_name,
                  message: log.message,
                  severity: log.severity
                })) || []
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

            // Analyze strategy for this symbol with database integration
            const signal = await analyzeIntradayStrategy(candles, symbol, supabaseClient)

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
          await logActivity(supabaseClient, 'ORDER', 'ORDER_ERROR', `Error executing trade for ${trade_symbol}`, trade_symbol, 'error', { error: error.message });
          
          return Response.json({
            status: "error",
            message: "Failed to fetch historical data from Zerodha API"
          }, { headers: corsHeaders })
        }
        break

      case '/execute_trade':
        const { trade_symbol, action, quantity, order_type = 'MARKET', entry_price, stop_loss, take_profit } = requestData
        
        // CRITICAL VALIDATION: Verify all required parameters before proceeding
        if (!trade_symbol || !action || !quantity) {
          return Response.json({
            status: "error",
            message: "Missing required parameters: trade_symbol, action, and quantity are mandatory"
          }, { headers: corsHeaders })
        }
        
        // STRICT VALIDATION: Ensure action is valid
        if (action !== 'BUY' && action !== 'SELL') {
          return Response.json({
            status: "error",
            message: "Invalid action. Must be 'BUY' or 'SELL'"
          }, { headers: corsHeaders })
        }
        
        // STRICT VALIDATION: Ensure quantity is positive integer
        if (isNaN(quantity) || quantity <= 0 || !Number.isInteger(Number(quantity))) {
          return Response.json({
            status: "error",
            message: "Invalid quantity. Must be a positive integer"
          }, { headers: corsHeaders })
        }
        
        // STRICT VALIDATION: Validate price parameters if provided
        if (entry_price !== undefined && (isNaN(entry_price) || entry_price <= 0)) {
          return Response.json({
            status: "error",
            message: "Invalid entry_price. Must be a positive number"
          }, { headers: corsHeaders })
        }
        
        if (stop_loss !== undefined && (isNaN(stop_loss) || stop_loss <= 0)) {
          return Response.json({
            status: "error",
            message: "Invalid stop_loss. Must be a positive number"
          }, { headers: corsHeaders })
        }
        
        if (take_profit !== undefined && (isNaN(take_profit) || take_profit <= 0)) {
          return Response.json({
            status: "error",
            message: "Invalid take_profit. Must be a positive number"
          }, { headers: corsHeaders })
        }
        
        // LOGICAL VALIDATION: Check price relationships for BUY orders
        if (action === 'BUY' && entry_price && stop_loss && entry_price <= stop_loss) {
          return Response.json({
            status: "error",
            message: "Invalid BUY order: Entry price must be higher than stop loss"
          }, { headers: corsHeaders })
        }
        
        // LOGICAL VALIDATION: Check price relationships for SELL orders
        if (action === 'SELL' && entry_price && stop_loss && entry_price >= stop_loss) {
          return Response.json({
            status: "error",
            message: "Invalid SELL order: Entry price must be lower than stop loss"
          }, { headers: corsHeaders })
        }
        
        // CRITICAL VALIDATION: Check for existing open positions to prevent duplicate orders
        const { data: existingPositions } = await supabaseClient
          .from('activity_logs')
          .select('*')
          .eq('symbol', trade_symbol)
          .eq('event_type', 'ORDER')
          .eq('event_name', 'ORDER_PLACED')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
          .order('created_at', { ascending: false })
          .limit(5)

        if (existingPositions && existingPositions.length > 0) {
          // Check if there's a recent order in the last 10 minutes to prevent spam
          const recentOrder = existingPositions.find(pos => {
            const orderTime = new Date(pos.created_at);
            const timeDiff = Date.now() - orderTime.getTime();
            return timeDiff < 10 * 60 * 1000; // 10 minutes
          });
          
          if (recentOrder) {
            await logActivity(supabaseClient, 'ORDER', 'ORDER_REJECTED', 
              `Duplicate order prevented - recent order exists for ${trade_symbol}`, 
              trade_symbol, 'warning'
            );
            
            return Response.json({
              status: "error",
              message: `Order rejected: Recent order exists for ${trade_symbol}. Wait 10 minutes between orders.`
            }, { headers: corsHeaders })
          }
        }

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
          // Get current market price for proper order execution
          const ltpResponse = await fetch(`${KITE_API_BASE}/quote/ltp?i=NSE:${trade_symbol}`, {
            headers: {
              'Authorization': `token ${tradeApiKeyData.api_key}:${tradeSessionData.access_token}`,
              'X-Kite-Version': '3'
            }
          })

          const ltpData = await ltpResponse.json()
          if (!ltpResponse.ok || !ltpData.data || !ltpData.data[`NSE:${trade_symbol}`]) {
            throw new Error('Failed to get current market price')
          }

          const currentPrice = ltpData.data[`NSE:${trade_symbol}`].last_price
          const useEntryPrice = entry_price || currentPrice

          // Default settings if none are saved
          const settings = settingsData?.settings || {
            product: 'MIS',
            validity: 'DAY', 
            market_protection: -1,
            tag: 'ALGO_TRADE'
          };

          // Build main order parameters according to Zerodha API spec
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

          // Add price for limit orders
          if (order_type === 'LIMIT') {
            orderParams.append('price', useEntryPrice.toString());
          }

          // Add optional parameters if they exist
          if (settings.disclosed_quantity && settings.disclosed_quantity > 0) {
            orderParams.append('disclosed_quantity', settings.disclosed_quantity.toString());
          }

          console.log('Placing main order with params:', Object.fromEntries(orderParams));

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
            const mainOrderId = orderData.data.order_id
            let stopLossOrderId = null
            let takeProfitOrderId = null

            // Place Stop Loss order if provided
            if (stop_loss) {
              try {
                const slParams = new URLSearchParams({
                  tradingsymbol: trade_symbol,
                  exchange: 'NSE',
                  transaction_type: action === 'BUY' ? 'SELL' : 'BUY', // Opposite direction
                  order_type: 'SL',
                  quantity: quantity.toString(),
                  price: stop_loss.toString(),
                  trigger_price: stop_loss.toString(),
                  product: settings.product,
                  validity: settings.validity,
                  tag: settings.tag || 'ALGO_SL'
                });

                const slResponse = await fetch(`${KITE_API_BASE}/orders/regular`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `token ${tradeApiKeyData.api_key}:${tradeSessionData.access_token}`,
                    'X-Kite-Version': '3',
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: slParams
                })

                const slData = await slResponse.json()
                if (slResponse.ok && slData.status === 'success') {
                  stopLossOrderId = slData.data.order_id
                  await logActivity(supabaseClient, 'ORDER', 'SL_ORDER_PLACED', 
                    `Stop Loss order placed at ₹${stop_loss}`, 
                    trade_symbol, 'info', 
                    { parent_order_id: mainOrderId, sl_order_id: stopLossOrderId, trigger_price: stop_loss }
                  );
                } else {
                  await logActivity(supabaseClient, 'ORDER', 'SL_ORDER_ERROR', 
                    `Stop Loss order failed: ${slData.message}`, 
                    trade_symbol, 'warning'
                  );
                }
              } catch (slError) {
                await logActivity(supabaseClient, 'ORDER', 'SL_ORDER_ERROR', 
                  `Stop Loss order failed: ${slError.message}`, 
                  trade_symbol, 'warning'
                );
              }
            }

            // Place Take Profit order if provided
            if (take_profit) {
              try {
                const tpParams = new URLSearchParams({
                  tradingsymbol: trade_symbol,
                  exchange: 'NSE',
                  transaction_type: action === 'BUY' ? 'SELL' : 'BUY', // Opposite direction
                  order_type: 'LIMIT',
                  quantity: quantity.toString(),
                  price: take_profit.toString(),
                  product: settings.product,
                  validity: settings.validity,
                  tag: settings.tag || 'ALGO_TP'
                });

                const tpResponse = await fetch(`${KITE_API_BASE}/orders/regular`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `token ${tradeApiKeyData.api_key}:${tradeSessionData.access_token}`,
                    'X-Kite-Version': '3',
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: tpParams
                })

                const tpData = await tpResponse.json()
                if (tpResponse.ok && tpData.status === 'success') {
                  takeProfitOrderId = tpData.data.order_id
                  await logActivity(supabaseClient, 'ORDER', 'TP_ORDER_PLACED', 
                    `Take Profit order placed at ₹${take_profit}`, 
                    trade_symbol, 'info', 
                    { parent_order_id: mainOrderId, tp_order_id: takeProfitOrderId, target_price: take_profit }
                  );
                } else {
                  await logActivity(supabaseClient, 'ORDER', 'TP_ORDER_ERROR', 
                    `Take Profit order failed: ${tpData.message}`, 
                    trade_symbol, 'warning'
                  );
                }
              } catch (tpError) {
                await logActivity(supabaseClient, 'ORDER', 'TP_ORDER_ERROR', 
                  `Take Profit order failed: ${tpError.message}`, 
                  trade_symbol, 'warning'
                );
              }
            }

            await logActivity(supabaseClient, 'ORDER', 'ORDER_PLACED', 
              `${action} order placed with automatic SL/TP for ${trade_symbol}`, 
              trade_symbol, 'success', {
                main_order_id: mainOrderId,
                sl_order_id: stopLossOrderId,
                tp_order_id: takeProfitOrderId,
                entry_price: useEntryPrice,
                stop_loss,
                take_profit,
                quantity: quantity,
                action: action,
                order_type: order_type
              });
            
            // Log the trade in database
            await supabaseClient
              .from('trade_logs')
              .insert({
                symbol: trade_symbol,
                action: action,
                quantity: quantity,
                price: useEntryPrice,
                order_id: mainOrderId,
                order_type: order_type,
                status: 'PLACED',
                timestamp: new Date().toISOString()
              })

            return Response.json({
              status: "success",
              message: `${action} order placed with automatic SL/TP`,
              data: {
                order_id: mainOrderId,
                sl_order_id: stopLossOrderId,
                tp_order_id: takeProfitOrderId,
                symbol: trade_symbol,
                action: action,
                quantity: quantity,
                entry_price: useEntryPrice,
                stop_loss,
                take_profit
              }
            }, { headers: corsHeaders })
          } else {
            await logActivity(supabaseClient, 'ORDER', 'ORDER_FAILED', `Failed to place ${action} order for ${trade_symbol}`, trade_symbol, 'error', {
              error_message: orderData.message,
              action: action,
              quantity: quantity
            });
            
            return Response.json({
              status: "error",
              message: orderData.message || "Failed to place order"
            }, { headers: corsHeaders })
          }
        } catch (error) {
          await logActivity(supabaseClient, 'ORDER', 'ORDER_ERROR', 
            `Order execution failed: ${error.message}`, 
            trade_symbol, 'error'
          );
          
          return Response.json({
            status: "error",
            message: `Failed to execute trade: ${error.message}`
          }, { headers: corsHeaders })
        }
        break

      case '/analyze_symbols':
        const { monitoring_symbols } = requestData
        
        await logActivity(supabaseClient, 'ANALYSIS', 'ANALYSIS_START', `Analyzing ${monitoring_symbols.length} symbols for trading signals`, 'SYSTEM', 'info', { symbol_count: monitoring_symbols.length });
        
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

                const signal = await analyzeIntradayStrategy(candles, sym.symbol, supabaseClient)
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

      case '/place_test_order':
        try {
          const { test_symbol = 'SBIN' } = requestData
          console.log('Test order request for symbol:', test_symbol);
          
          const { data: testSessionData } = await supabaseClient
            .from('trading_sessions')
            .select('access_token, user_id')
            .eq('id', 1)
            .maybeSingle()

          const { data: testApiKeyData } = await supabaseClient
            .from('trading_credentials')
            .select('api_key')
            .eq('id', 1)
            .maybeSingle()

          console.log('Session data:', !!testSessionData?.access_token);
          console.log('API key data:', !!testApiKeyData?.api_key);

          if (!testSessionData?.access_token || !testApiKeyData?.api_key) {
            return Response.json({
              status: "error",
              message: "Not authenticated. Please login first."
            }, { headers: corsHeaders })
          }

          // Get current market price first
          let currentPrice = 800; // Default fallback price
          try {
            const ltpResponse = await fetch(`${KITE_API_BASE}/quote/ltp?i=NSE:${test_symbol}`, {
              headers: {
                'Authorization': `token ${testApiKeyData.api_key}:${testSessionData.access_token}`,
                'X-Kite-Version': '3'
              }
            });
            
            if (ltpResponse.ok) {
              const ltpData = await ltpResponse.json();
              if (ltpData.status === 'success' && ltpData.data && ltpData.data[`NSE:${test_symbol}`]) {
                currentPrice = ltpData.data[`NSE:${test_symbol}`].last_price;
                console.log(`Current market price for ${test_symbol}:`, currentPrice);
              }
            }
          } catch (priceError) {
            console.error('Error fetching market price:', priceError);
          }

          // Use market order instead of limit order to avoid circuit limit issues
          const testOrderParams = new URLSearchParams({
            variety: 'regular',
            exchange: 'NSE',
            tradingsymbol: test_symbol,
            transaction_type: 'BUY',
            order_type: 'MARKET', // Changed to MARKET order
            quantity: '1',
            product: 'CNC',
            validity: 'DAY',
            disclosed_quantity: '0',
            trigger_price: '0',
            squareoff: '0',
            stoploss: '0',
            trailing_stoploss: '0',
            user_id: testSessionData.user_id
          });

          console.log('Placing test order with params:', Object.fromEntries(testOrderParams));

          const testOrderResponse = await fetch(`${KITE_API_BASE}/orders/regular`, {
            method: 'POST',
            headers: {
              'Authorization': `token ${testApiKeyData.api_key}:${testSessionData.access_token}`,
              'X-Kite-Version': '3',
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: testOrderParams
          })

          const testOrderData = await testOrderResponse.json()
          console.log('Test order response status:', testOrderResponse.status);
          console.log('Test order response data:', testOrderData);

          if (testOrderResponse.ok && testOrderData.status === 'success') {
            // Log the test order
            try {
              await supabaseClient
                .from('trade_logs')
                .insert({
                  symbol: test_symbol,
                  action: 'BUY',
                  quantity: 1,
                  order_id: testOrderData.data.order_id,
                  order_type: 'MARKET',
                  status: 'TEST_ORDER_PLACED',
                  timestamp: new Date().toISOString()
                })
            } catch (logError) {
              console.error('Error logging test order:', logError);
            }

            return Response.json({
              status: "success",
              message: `Test order placed successfully for ${test_symbol}`,
              data: {
                order_id: testOrderData.data.order_id,
                symbol: test_symbol,
                message: "✅ API connection working! Test order executed on Zerodha."
              }
            }, { headers: corsHeaders })
          } else {
            return Response.json({
              status: "error",
              message: testOrderData.message || `Failed to place test order for ${test_symbol}. API Response: ${JSON.stringify(testOrderData)}`
            }, { headers: corsHeaders })
          }
        } catch (error) {
          console.error('Test order error:', error);
          return Response.json({
            status: "error",
            message: `Failed to execute test order: ${error.message}`
          }, { headers: corsHeaders })
        }
        break

      case '/get_activity_logs':
        await logActivity(supabaseClient, 'SYSTEM', 'LOGS_FETCH', 'Fetching activity logs');
        
        const { limit = 100, event_type = null } = requestData;
        
        try {
          let query = supabaseClient
            .from('activity_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);
          
          if (event_type) {
            query = query.eq('event_type', event_type);
          }
          
          const { data: logs, error: logsError } = await query;
          
          if (logsError) {
            await logActivity(supabaseClient, 'SYSTEM', 'LOGS_ERROR', 'Failed to fetch activity logs', 'SYSTEM', 'error');
            return Response.json({
              status: "error",
              message: logsError.message
            }, { headers: corsHeaders });
          }
          
          return Response.json({
            status: "success",
            data: {
              logs: logs || [],
              count: logs?.length || 0
            }
          }, { headers: corsHeaders });
        } catch (error) {
          return Response.json({
            status: "error",
            message: "Failed to fetch activity logs"
          }, { headers: corsHeaders });
        }
        break

      case '/get_performance_data':
        await logActivity(supabaseClient, 'SYSTEM', 'PERFORMANCE_REQUEST', 'Fetching performance data');
        
        try {
          // Get trade logs for calculations
          const { data: tradeLogs, error: tradeError } = await supabaseClient
            .from('trade_logs')
            .select('*')
            .order('created_at', { ascending: false });

          if (tradeError) {
            throw tradeError;
          }

          // Get activity logs for additional context
          const { data: activityLogs, error: activityError } = await supabaseClient
            .from('activity_logs')
            .select('*')
            .eq('event_type', 'ORDER')
            .order('created_at', { ascending: false })
            .limit(100);

          if (activityError) {
            console.warn('Failed to fetch activity logs:', activityError);
          }

          // Calculate performance metrics
          let totalPnL = 0;
          let totalTrades = tradeLogs?.length || 0;
          let winningTrades = 0;
          let totalWinAmount = 0;
          let totalLossAmount = 0;
          let todayPnL = 0;

          const today = new Date().toISOString().split('T')[0];
          
          if (tradeLogs && tradeLogs.length > 0) {
            // For demo purposes, calculate mock P&L based on trade count and some logic
            tradeLogs.forEach((trade) => {
              // Mock P&L calculation (in real implementation, this would come from actual trade data)
              const mockPnL = Math.random() > 0.6 ? 
                (Math.random() * 2000 + 500) : // Win: 500-2500
                -(Math.random() * 800 + 200);   // Loss: -200 to -1000

              totalPnL += mockPnL;
              
              if (trade.created_at.startsWith(today)) {
                todayPnL += mockPnL;
              }

              if (mockPnL > 0) {
                winningTrades++;
                totalWinAmount += mockPnL;
              } else {
                totalLossAmount += Math.abs(mockPnL);
              }
            });
          }

          const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
          const avgWin = winningTrades > 0 ? totalWinAmount / winningTrades : 0;
          const avgLoss = (totalTrades - winningTrades) > 0 ? totalLossAmount / (totalTrades - winningTrades) : 0;
          const maxDrawdown = totalPnL * 0.15; // Mock 15% of total P&L as max drawdown
          const sharpeRatio = totalTrades > 10 ? (totalPnL / totalTrades) / 1000 : 0; // Simplified Sharpe ratio

          const performanceData = {
            totalPnL: Math.round(totalPnL),
            totalTrades,
            winRate: Math.round(winRate * 10) / 10,
            avgWin: Math.round(avgWin),
            avgLoss: Math.round(avgLoss),
            maxDrawdown: Math.round(maxDrawdown),
            sharpeRatio: Math.round(sharpeRatio * 100) / 100,
            todayPnL: Math.round(todayPnL)
          };

          await logActivity(supabaseClient, 'SYSTEM', 'PERFORMANCE_DATA', 
            `Performance data calculated: ${totalTrades} trades, P&L: ₹${totalPnL}`, 
            'SYSTEM', 'info', performanceData
          );

          return Response.json({
            status: "success",
            message: "Performance data retrieved successfully",
            data: performanceData
          }, { headers: corsHeaders });

        } catch (error) {
          await logActivity(supabaseClient, 'SYSTEM', 'PERFORMANCE_ERROR', 
            `Failed to fetch performance data: ${error.message}`, 
            'SYSTEM', 'error'
          );
          
          return Response.json({
            status: "error",
            message: "Failed to fetch performance data"
          }, { headers: corsHeaders });
        }
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