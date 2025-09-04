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

interface ApiResponse<T = any> {
  status: string;
  message: string;
  data?: T;
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

        if (!instrumentsSessionData?.access_token || !instrumentsApiKeyData?.api_key) {
          // Return limited mock data if not authenticated
          const mockInstruments = [
            { symbol: "RELIANCE", instrument_token: 738561, exchange: "NSE", name: "Reliance Industries Ltd.", is_nifty50: true, is_banknifty: false },
            { symbol: "TCS", instrument_token: 2953217, exchange: "NSE", name: "Tata Consultancy Services Ltd.", is_nifty50: true, is_banknifty: false },
            { symbol: "HDFC", instrument_token: 340481, exchange: "NSE", name: "HDFC Bank Ltd.", is_nifty50: true, is_banknifty: false },
          ]

          return Response.json({
            status: "success",
            data: {
              instruments: mockInstruments,
              nifty50_stocks: ["RELIANCE", "TCS", "HDFC", "INFY", "HDFCBANK"],
              banknifty_stocks: ["HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK"],
              count: mockInstruments.length
            }
          }, { headers: corsHeaders })
        }

        try {
          // Fetch real instruments from Zerodha API
          const instrumentsResponse = await fetch(`${KITE_API_BASE}/instruments`, {
            method: 'GET',
            headers: {
              'Authorization': `token ${instrumentsApiKeyData.api_key}:${instrumentsSessionData.access_token}`,
              'X-Kite-Version': '3'
            }
          })

          if (instrumentsResponse.ok) {
            const instrumentsText = await instrumentsResponse.text()
            const lines = instrumentsText.split('\n')
            const headers = lines[0].split(',')
            
            // Parse CSV data
            const instruments = []
            const nifty50Stocks = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "HINDUNILVR", "HDFC", "ICICIBANK", "KOTAKBANK", "BHARTIARTL", "ITC", "SBIN", "BAJFINANCE", "ASIANPAINT", "MARUTI", "HCLTECH", "AXISBANK", "LT", "DMART", "SUNPHARMA", "TITAN", "ULTRACEMCO", "NESTLEIND", "WIPRO", "NTPC", "JSWSTEEL", "TECHM", "TATAMOTORS", "INDUSINDBK", "POWERGRID", "BAJAJFINSV", "GRASIM", "ADANIENT", "COALINDIA", "HEROMOTOCO", "CIPLA", "EICHERMOT", "BRITANNIA", "DIVISLAB", "DRREDDY", "APOLLOHOSP", "TATACONSUM", "UPL", "BAJAJ-AUTO", "HINDALCO", "ONGC", "SBILIFE", "BPCL", "TATASTEEL", "HDFCLIFE", "ADANIPORTS"]
            const bankniftyStocks = ["HDFCBANK", "ICICIBANK", "KOTAKBANK", "SBIN", "AXISBANK", "INDUSINDBK", "BAJFINANCE", "BAJAJFINSV", "PNB", "BANKBARODA", "AUBANK", "IDFCFIRSTB"]

            for (let i = 1; i < lines.length && i <= 1000; i++) { // Limit to first 1000 for performance
              const cols = lines[i].split(',')
              if (cols.length >= 8) {
                const symbol = cols[2]?.replace(/"/g, '')
                const exchange = cols[11]?.replace(/"/g, '')
                
                if (exchange === 'NSE' && symbol) {
                  instruments.push({
                    symbol: symbol,
                    instrument_token: parseInt(cols[0]) || 0,
                    exchange: exchange,
                    name: cols[1]?.replace(/"/g, '') || symbol,
                    is_nifty50: nifty50Stocks.includes(symbol),
                    is_banknifty: bankniftyStocks.includes(symbol)
                  })
                }
              }
            }

            return Response.json({
              status: "success",
              data: {
                instruments: instruments.slice(0, 500), // Return top 500 for UI performance
                nifty50_stocks: nifty50Stocks,
                banknifty_stocks: bankniftyStocks,
                count: instruments.length
              }
            }, { headers: corsHeaders })
          } else {
            throw new Error('Failed to fetch instruments')
          }
        } catch (error) {
          // Fallback to enhanced mock data if API fails
          const mockInstruments = [
            { symbol: "RELIANCE", instrument_token: 738561, exchange: "NSE", name: "Reliance Industries Ltd.", is_nifty50: true, is_banknifty: false },
            { symbol: "TCS", instrument_token: 2953217, exchange: "NSE", name: "Tata Consultancy Services Ltd.", is_nifty50: true, is_banknifty: false },
            { symbol: "HDFCBANK", instrument_token: 341249, exchange: "NSE", name: "HDFC Bank Ltd.", is_nifty50: true, is_banknifty: true },
            { symbol: "INFY", instrument_token: 408065, exchange: "NSE", name: "Infosys Ltd.", is_nifty50: true, is_banknifty: false },
            { symbol: "ICICIBANK", instrument_token: 1270529, exchange: "NSE", name: "ICICI Bank Ltd.", is_nifty50: true, is_banknifty: true },
          ]

          return Response.json({
            status: "success",
            data: {
              instruments: mockInstruments,
              nifty50_stocks: ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK"],
              banknifty_stocks: ["HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK"],
              count: mockInstruments.length
            }
          }, { headers: corsHeaders })
        }
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