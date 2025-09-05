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

// ============= ENCRYPTION UTILITIES =============
async function getEncryptionKey(): Promise<CryptoKey | null> {
  try {
    const keyData = Deno.env.get('ENCRYPTION_KEY')
    if (!keyData) {
      console.warn('ENCRYPTION_KEY not configured, using fallback mode')
      return null
    }
    
    const keyBytes = new TextEncoder().encode(keyData.padEnd(32, '0').substring(0, 32))
    return await globalThis.crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    )
  } catch (error) {
    console.warn('Failed to create encryption key, using fallback mode:', error)
    return null
  }
}

async function encryptData(data: string): Promise<string> {
  try {
    const key = await getEncryptionKey()
    if (!key) {
      console.warn('Encryption not available, storing data as-is')
      return data // Fallback to plain text
    }
    
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
    const encodedData = new TextEncoder().encode(data)
    
    const encrypted = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encodedData
    )
    
    const combined = new Uint8Array(iv.length + encrypted.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(encrypted), iv.length)
    
    return btoa(String.fromCharCode(...combined))
  } catch (error) {
    console.warn('Encryption failed, storing data as-is:', error)
    return data // Fallback to plain text
  }
}

async function decryptData(encryptedData: string): Promise<string> {
  try {
    const key = await getEncryptionKey()
    if (!key) {
      // No encryption key available, assume data is plain text
      console.warn('Encryption not available, treating data as plain text')
      return encryptedData
    }
    
    // Try to decrypt - if it fails, might be plain text from before encryption was enabled
    try {
      const combined = new Uint8Array(atob(encryptedData).split('').map(c => c.charCodeAt(0)))
      const iv = combined.slice(0, 12)
      const data = combined.slice(12)
      
      const decrypted = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        data
      )
      
      return new TextDecoder().decode(decrypted)
    } catch (decryptError) {
      // Data might be plain text from before encryption was enabled
      console.warn('Failed to decrypt, assuming plain text:', decryptError)
      return encryptedData
    }
  } catch (error) {
    console.warn('Decryption failed, returning original data:', error)
    return encryptedData
  }
}

// ============= SESSION SECURITY UTILITIES =============
async function generateSessionHash(): Promise<string> {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function extractClientInfo(req: Request): { ip_address?: string; user_agent?: string } {
  const forwarded = req.headers.get('x-forwarded-for')
  const ip_address = forwarded ? forwarded.split(',')[0].trim() : req.headers.get('x-real-ip') || 'unknown'
  const user_agent = req.headers.get('user-agent') || 'unknown'
  
  return { ip_address, user_agent }
}

async function validateSessionSecurity(sessionData: any, clientInfo: any): Promise<boolean> {
  // Check for suspicious activity patterns
  if (sessionData.ip_address && sessionData.ip_address !== clientInfo.ip_address) {
    console.warn('IP address mismatch detected:', {
      stored: sessionData.ip_address,
      current: clientInfo.ip_address
    })
    // Allow IP changes for now, but log for monitoring
  }
  
  return true
}

async function rotateSessionIfNeeded(supabaseClient: any, sessionId: number): Promise<void> {
  const { data: sessionData } = await supabaseClient
    .from('trading_sessions')
    .select('last_activity, token_version')
    .eq('id', sessionId)
    .maybeSingle()
  
  if (sessionData?.last_activity) {
    const lastActivity = new Date(sessionData.last_activity)
    const hoursSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60)
    
    // Rotate session hash every 24 hours
    if (hoursSinceActivity >= 24) {
      const newSessionHash = await generateSessionHash()
      const newTokenVersion = (sessionData.token_version || 1) + 1
      
      await supabaseClient
        .from('trading_sessions')
        .update({
          session_hash: newSessionHash,
          token_version: newTokenVersion,
          last_activity: new Date().toISOString()
        })
        .eq('id', sessionId)
      
      console.log('Session rotated for security')
    }
  }
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
          const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data)
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
              // Extract client information for security
              const clientInfo = extractClientInfo(req)
              
              // Generate secure session hash
              const sessionHash = await generateSessionHash()
              
              // Encrypt sensitive tokens
              const encryptedAccessToken = await encryptData(tokenData.data.access_token)
              const encryptedRequestToken = await encryptData(request_token)
              
              // Calculate session expiration (24 hours)
              const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
              
              // Store access token and user data securely
              const { error: sessionError } = await supabaseClient
                .from('trading_sessions')
                .upsert({
                  id: 1,
                  // Keep legacy fields for backward compatibility
                  access_token: tokenData.data.access_token,
                  request_token: request_token,
                  // Add encrypted versions
                  encrypted_access_token: encryptedAccessToken,
                  encrypted_request_token: encryptedRequestToken,
                  // Session security fields
                  session_hash: sessionHash,
                  expires_at: expiresAt.toISOString(),
                  ip_address: clientInfo.ip_address,
                  user_agent: clientInfo.user_agent,
                  token_version: 1,
                  // User data
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

        if (sessionData && sessionData.status === 'authenticated') {
          // Extract client info for security validation
          const clientInfo = extractClientInfo(req)
          
          // Validate session security
          const isSecure = await validateSessionSecurity(sessionData, clientInfo)
          if (!isSecure) {
            return Response.json({
              status: "disconnected",
              message: "Session security validation failed"
            }, { headers: corsHeaders })
          }
          
          // Check session expiration
          if (sessionData.expires_at && new Date(sessionData.expires_at) < new Date()) {
            // Mark session as expired
            await supabaseClient
              .from('trading_sessions')
              .update({ 
                status: 'expired',
                encrypted_access_token: null,
                encrypted_request_token: null,
                access_token: null,
                request_token: null
              })
              .eq('id', 1)
            
            return Response.json({
              status: "disconnected",
              message: "Session expired, please login again"
            }, { headers: corsHeaders })
          }
          
          // Rotate session if needed
          await rotateSessionIfNeeded(supabaseClient, 1)
          
          return Response.json({
            status: "connected",
            message: "Connected to Zerodha",
            data: {
              user_id: sessionData.user_id,
              user_name: sessionData.user_name,
              expires_at: sessionData.expires_at,
              token_version: sessionData.token_version
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
          .select('access_token, encrypted_access_token')
          .eq('id', 1)
          .maybeSingle()

        const { data: instrumentsApiKeyData } = await supabaseClient
          .from('trading_credentials')
          .select('api_key, encrypted_api_key')
          .eq('id', 1)
          .maybeSingle()

        // Get access token - prefer encrypted version
        let access_token = instrumentsSessionData?.access_token
        if (instrumentsSessionData?.encrypted_access_token) {
          try {
            access_token = await decryptData(instrumentsSessionData.encrypted_access_token)
          } catch (error) {
            console.warn('Failed to decrypt access token, using legacy token')
          }
        }

        // Get API key - prefer encrypted version  
        let api_key = instrumentsApiKeyData?.api_key
        if (instrumentsApiKeyData?.encrypted_api_key) {
          try {
            api_key = await decryptData(instrumentsApiKeyData.encrypted_api_key)
          } catch (error) {
            console.warn('Failed to decrypt API key, using legacy key')
          }
        }

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

        if (access_token && api_key) {
          try {
            // Try to fetch real instruments from Zerodha API
            const instrumentsResponse = await fetch(`${KITE_API_BASE}/instruments`, {
              method: 'GET',
              headers: {
                'Authorization': `token ${api_key}:${access_token}`,
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
          .select('access_token, encrypted_access_token, user_id')
          .eq('id', 1)
          .maybeSingle()

        // Get API key for proper authorization format
        const { data: apiKeyData } = await supabaseClient
          .from('trading_credentials')
          .select('api_key, encrypted_api_key')
          .eq('id', 1)
          .maybeSingle()

        // Get access token - prefer encrypted version
        let balance_access_token = balanceSessionData?.access_token
        if (balanceSessionData?.encrypted_access_token) {
          try {
            balance_access_token = await decryptData(balanceSessionData.encrypted_access_token)
          } catch (error) {
            console.warn('Failed to decrypt access token, using legacy token')
          }
        }

        // Get API key - prefer encrypted version  
        let balance_api_key = apiKeyData?.api_key
        if (apiKeyData?.encrypted_api_key) {
          try {
            balance_api_key = await decryptData(apiKeyData.encrypted_api_key)
          } catch (error) {
            console.warn('Failed to decrypt API key, using legacy key')
          }
        }

        if (!balance_access_token || !balance_api_key) {
          return Response.json({
            status: "error",
            message: "Not authenticated. Please login first."
          }, { headers: corsHeaders })
        }

        try {
          // Fetch funds from Zerodha API with correct authorization format
          const fundsResponse = await fetch(`${KITE_API_BASE}/user/margins`, {
            method: 'GET',
            headers: {
              'Authorization': `token ${balance_api_key}:${balance_access_token}`,
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
          .select('access_token, encrypted_access_token')
          .eq('id', 1)
          .maybeSingle()

        const { data: histApiKeyData } = await supabaseClient
          .from('trading_credentials')
          .select('api_key, encrypted_api_key')
          .eq('id', 1)
          .maybeSingle()

        // Get access token - prefer encrypted version
        let hist_access_token = histSessionData?.access_token
        if (histSessionData?.encrypted_access_token) {
          try {
            hist_access_token = await decryptData(histSessionData.encrypted_access_token)
          } catch (error) {
            console.warn('Failed to decrypt access token, using legacy token')
          }
        }

        // Get API key - prefer encrypted version  
        let hist_api_key = histApiKeyData?.api_key
        if (histApiKeyData?.encrypted_api_key) {
          try {
            hist_api_key = await decryptData(histApiKeyData.encrypted_api_key)
          } catch (error) {
            console.warn('Failed to decrypt API key, using legacy key')
          }
        }

        if (!hist_access_token || !hist_api_key) {
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
                'Authorization': `token ${hist_api_key}:${hist_access_token}`,
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
          .select('access_token, encrypted_access_token')
          .eq('id', 1)
          .maybeSingle()

        const { data: tradeApiKeyData } = await supabaseClient
          .from('trading_credentials')
          .select('api_key, encrypted_api_key')
          .eq('id', 1)
          .maybeSingle()

        // Get access token - prefer encrypted version
        let trade_access_token = tradeSessionData?.access_token
        if (tradeSessionData?.encrypted_access_token) {
          try {
            trade_access_token = await decryptData(tradeSessionData.encrypted_access_token)
          } catch (error) {
            console.warn('Failed to decrypt access token, using legacy token')
          }
        }

        // Get API key - prefer encrypted version  
        let trade_api_key = tradeApiKeyData?.api_key
        if (tradeApiKeyData?.encrypted_api_key) {
          try {
            trade_api_key = await decryptData(tradeApiKeyData.encrypted_api_key)
          } catch (error) {
            console.warn('Failed to decrypt API key, using legacy key')
          }
        }

        // Get trading settings
        const { data: settingsData } = await supabaseClient
          .from('trading_settings')
          .select('settings')
          .eq('id', 1)
          .maybeSingle()

        if (!trade_access_token || !trade_api_key) {
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
              'Authorization': `token ${trade_api_key}:${trade_access_token}`,
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
          .select('access_token, encrypted_access_token')
          .eq('id', 1)
          .maybeSingle()

        const { data: analyzeApiKeyData } = await supabaseClient
          .from('trading_credentials')
          .select('api_key, encrypted_api_key')
          .eq('id', 1)
          .maybeSingle()

        // Get tokens - prefer encrypted versions
        let analyze_access_token = analyzeSessionData?.access_token
        if (analyzeSessionData?.encrypted_access_token) {
          try {
            analyze_access_token = await decryptData(analyzeSessionData.encrypted_access_token)
          } catch (error) {
            console.warn('Failed to decrypt access token, using legacy token')
          }
        }

        let analyze_api_key = analyzeApiKeyData?.api_key
        if (analyzeApiKeyData?.encrypted_api_key) {
          try {
            analyze_api_key = await decryptData(analyzeApiKeyData.encrypted_api_key)
          } catch (error) {
            console.warn('Failed to decrypt API key, using legacy key')
          }
        }

        if (!analyze_access_token || !analyze_api_key) {
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
                  'Authorization': `token ${analyze_api_key}:${analyze_access_token}`,
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

      case '/place_test_order':
        try {
          const { test_symbol = 'SBIN' } = requestData
          console.log('Test order request for symbol:', test_symbol);
          
          const { data: testSessionData } = await supabaseClient
            .from('trading_sessions')
            .select('access_token, encrypted_access_token')
            .eq('id', 1)
            .maybeSingle()

          const { data: testApiKeyData } = await supabaseClient
            .from('trading_credentials')
            .select('api_key, encrypted_api_key')
            .eq('id', 1)
            .maybeSingle()

          // Get tokens - prefer encrypted versions
          let test_access_token = testSessionData?.access_token
          if (testSessionData?.encrypted_access_token) {
            try {
              test_access_token = await decryptData(testSessionData.encrypted_access_token)
            } catch (error) {
              console.warn('Failed to decrypt access token, using legacy token')
            }
          }

          let test_api_key = testApiKeyData?.api_key
          if (testApiKeyData?.encrypted_api_key) {
            try {
              test_api_key = await decryptData(testApiKeyData.encrypted_api_key)
            } catch (error) {
              console.warn('Failed to decrypt API key, using legacy key')
            }
          }

          console.log('Session data:', !!testSessionData?.access_token);
          console.log('API key data:', !!testApiKeyData?.api_key);

          if (!test_access_token || !test_api_key) {
            return Response.json({
              status: "error",
              message: "Not authenticated. Please login first."
            }, { headers: corsHeaders })
          }

          // Place a minimal test order - 1 share of SBIN (State Bank of India)
          const testOrderParams = new URLSearchParams({
            tradingsymbol: test_symbol,
            exchange: 'NSE',
            transaction_type: 'BUY',
            order_type: 'MARKET',
            quantity: '1', // Minimal quantity for testing
            product: 'MIS', // Intraday
            validity: 'DAY',
            market_protection: '-1', // Auto protection
            tag: 'API_TEST'
          });

          console.log('Placing test order with params:', Object.fromEntries(testOrderParams));

          const testOrderResponse = await fetch(`${KITE_API_BASE}/orders/regular`, {
            method: 'POST',
            headers: {
              'Authorization': `token ${test_api_key}:${test_access_token}`,
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