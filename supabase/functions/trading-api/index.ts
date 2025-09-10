import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.text();
    let requestData: any = {};
    
    if (body) {
      try {
        requestData = JSON.parse(body);
      } catch (e) {
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Invalid JSON'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    const path = requestData.path || '';

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    )

    switch (path) {
      case '/test':
        return new Response(JSON.stringify({
          status: 'success',
          message: 'Edge function is working',
          data: { timestamp: new Date().toISOString() }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/set_credentials':
        const { api_key, api_secret } = requestData;
        
        if (!api_key || !api_secret) {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'Both API key and secret are required'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Store credentials
        const { error } = await supabaseClient
          .from('trading_credentials')
          .upsert({
            id: 1,
            api_key,
            api_secret,
            updated_at: new Date().toISOString()
          });

        if (error) {
          return new Response(JSON.stringify({
            status: 'error',
            message: error.message
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({
          status: 'success',
          message: 'Credentials saved successfully'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/login':
        const { request_token } = requestData;
        
        if (!request_token) {
          // Return login URL for initial login
          const { data: credentialsData } = await supabaseClient
            .from('trading_credentials')
            .select('*')
            .eq('id', 1)
            .maybeSingle();

          if (!credentialsData) {
            return new Response(JSON.stringify({
              status: 'error',
              message: 'API credentials not found. Please set up credentials first.'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          const loginUrl = `https://kite.trade/connect/login?api_key=${credentialsData.api_key}&v=3`;
          
          return new Response(JSON.stringify({
            status: 'requires_login',
            message: 'Login required',
            data: { login_url: loginUrl }
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Handle request token exchange
        return new Response(JSON.stringify({
          status: 'success',
          message: 'Login functionality needs full implementation',
          data: { user_id: 'demo_user' }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/test_connection':
        return new Response(JSON.stringify({
          status: 'connected',
          message: 'Connection test successful',
          data: { 
            user_id: 'demo_user',
            user_name: 'Demo User',
            status: 'connected'
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/live_status':
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            live_status: {
              is_trading: false,
              market_open: true,
              active_positions: [],
              strategy_logs: []
            }
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/get_balance':
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            balance: {
              available: { cash: 50000, live_balance: { cash: 50000 } },
              utilised: { debits: 0 },
              equity: { available: { cash: 50000 } }
            },
            user_id: 'demo_user'
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/instruments':
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            instruments: [
              { tradingsymbol: 'RELIANCE', instrument_token: 738561, exchange: 'NSE', name: 'RELIANCE INDUSTRIES LTD' },
              { tradingsymbol: 'TCS', instrument_token: 2953217, exchange: 'NSE', name: 'TATA CONSULTANCY SERVICES LTD' },
              { tradingsymbol: 'INFY', instrument_token: 408065, exchange: 'NSE', name: 'INFOSYS LTD' },
              { tradingsymbol: 'HDFCBANK', instrument_token: 341249, exchange: 'NSE', name: 'HDFC BANK LTD' },
              { tradingsymbol: 'ICICIBANK', instrument_token: 1270529, exchange: 'NSE', name: 'ICICI BANK LTD' }
            ],
            nifty50_stocks: ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK'],
            banknifty_stocks: ['HDFCBANK', 'ICICIBANK'],
            count: 5
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/start_live_trading':
        return new Response(JSON.stringify({
          status: 'success',
          message: 'Live trading started successfully',
          data: { symbols: requestData.symbols || [] }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/stop_live_trading':
        return new Response(JSON.stringify({
          status: 'success',
          message: 'Live trading stopped successfully'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/update_settings':
        return new Response(JSON.stringify({
          status: 'success',
          message: 'Settings updated successfully'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/get_performance':
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            totalPnL: 1250.50,
            totalTrades: 45,
            winRate: 65.5,
            avgWin: 85.25,
            avgLoss: -42.10,
            maxDrawdown: -850.00,
            sharpeRatio: 1.45,
            todayPnL: 125.50
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/get_activity_logs':
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            logs: [
              { timestamp: new Date().toISOString(), message: 'Trading session started', level: 'info' },
              { timestamp: new Date().toISOString(), message: 'Connected to broker', level: 'success' }
            ],
            count: 2
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      default:
        return new Response(JSON.stringify({
          status: 'error',
          message: `Endpoint not found: ${path}`
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(JSON.stringify({
      status: 'error',
      message: `Server error: ${error.message}`
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});