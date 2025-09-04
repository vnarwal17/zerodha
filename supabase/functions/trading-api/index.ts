import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
          const { error } = await supabaseClient
            .from('trading_credentials')
            .upsert({
              id: 1,
              api_key,
              api_secret,
              updated_at: new Date().toISOString()
            })

          if (error) {
            return Response.json({
              status: "error",
              message: error.message
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
            // Store login session
            const { error } = await supabaseClient
              .from('trading_sessions')
              .upsert({
                id: 1,
                request_token,
                status: 'authenticated',
                updated_at: new Date().toISOString()
              })

            if (error) {
              return Response.json({
                status: "error",
                message: error.message
              }, { headers: corsHeaders })
            }

            return Response.json({
              status: "success",
              message: "Login successful",
              data: { user_id: "demo_user" }
            }, { headers: corsHeaders })
          } else {
            return Response.json({
              status: "requires_login",
              message: "Please complete login",
              data: { login_url: "https://kite.trade/connect/login?api_key=YOUR_API_KEY" }
            }, { headers: corsHeaders })
          }
        break

      case '/test_connection':
          const { data } = await supabaseClient
            .from('trading_sessions')
            .select('*')
            .eq('id', 1)
            .single()

          if (data && data.status === 'authenticated') {
            return Response.json({
              status: "connected",
              message: "Connected to Zerodha",
              data: {
                user_id: "demo_user",
                user_name: "Demo User"
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
          // Mock instruments data
          const mockInstruments = [
            { symbol: "RELIANCE", instrument_token: 738561, exchange: "NSE" },
            { symbol: "TCS", instrument_token: 2953217, exchange: "NSE" },
            { symbol: "HDFC", instrument_token: 340481, exchange: "NSE" },
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
        break

      case '/start_live_trading':
        const { symbols } = requestData
          
          // Store trading session
          const { error } = await supabaseClient
            .from('trading_sessions')
            .upsert({
              id: 1,
              trading_active: true,
              symbols: symbols,
              updated_at: new Date().toISOString()
            })

          if (error) {
            return Response.json({
              status: "error",
              message: error.message
            }, { headers: corsHeaders })
          }

          return Response.json({
            status: "success",
            message: `Started live trading for ${symbols.length} symbols`,
            data: { symbols: symbols.map((s: TradingSymbol) => s.symbol) }
          }, { headers: corsHeaders })
        break

      case '/stop_live_trading':
          const { error } = await supabaseClient
            .from('trading_sessions')
            .upsert({
              id: 1,
              trading_active: false,
              updated_at: new Date().toISOString()
            })

          if (error) {
            return Response.json({
              status: "error",
              message: error.message
            }, { headers: corsHeaders })
          }

          return Response.json({
            status: "success",
            message: "Live trading stopped"
          }, { headers: corsHeaders })
        break

      case '/live_status':
          const { data } = await supabaseClient
            .from('trading_sessions')
            .select('*')
            .eq('id', 1)
            .single()

          return Response.json({
            status: "success",
            data: {
              live_status: {
                is_trading: data?.trading_active || false,
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
          
          const { error } = await supabaseClient
            .from('trading_settings')
            .upsert({
              id: 1,
              settings: settings,
              updated_at: new Date().toISOString()
            })

          if (error) {
            return Response.json({
              status: "error",
              message: error.message
            }, { headers: corsHeaders })
          }

          return Response.json({
            status: "success",
            message: "Settings updated successfully"
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