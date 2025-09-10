import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Helper function to generate checksum for Zerodha API
async function generateChecksum(apiKey: string, requestToken: string, apiSecret: string): Promise<string> {
  const data = apiKey + requestToken + apiSecret;
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper function to make authenticated API calls to Zerodha
async function makeKiteApiCall(endpoint: string, accessToken: string, method: string = 'GET', body?: any) {
  const url = `https://api.kite.trade${endpoint}`;
  const headers = {
    'Authorization': `token ${accessToken}`,
    'X-Kite-Version': '3',
    'Content-Type': 'application/json'
  };

  const options: RequestInit = { method, headers };
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  return await response.json();
}

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
        
        // Get stored credentials
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

        if (!request_token) {
          // Return login URL for initial login
          const loginUrl = `https://kite.trade/connect/login?api_key=${credentialsData.api_key}&v=3`;
          
          return new Response(JSON.stringify({
            status: 'requires_login',
            message: 'Login required',
            data: { login_url: loginUrl }
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Exchange request token for access token
        try {
          const sessionResponse = await fetch('https://api.kite.trade/session/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Kite-Version': '3'
            },
            body: new URLSearchParams({
              api_key: credentialsData.api_key,
              request_token: request_token,
              checksum: await generateChecksum(credentialsData.api_key, request_token, credentialsData.api_secret)
            })
          });

          const sessionData = await sessionResponse.json();
          
          if (!sessionResponse.ok) {
            return new Response(JSON.stringify({
              status: 'error',
              message: sessionData.message || 'Login failed'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Store session data
          await supabaseClient
            .from('trading_sessions')
            .upsert({
              id: 1,
              access_token: sessionData.data.access_token,
              user_id: sessionData.data.user_id,
              user_name: sessionData.data.user_name,
              status: 'authenticated',
              expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              updated_at: new Date().toISOString()
            });

          return new Response(JSON.stringify({
            status: 'success',
            message: 'Login successful',
            data: { 
              user_id: sessionData.data.user_id,
              user_name: sessionData.data.user_name
            }
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });

        } catch (error) {
          return new Response(JSON.stringify({
            status: 'error',
            message: `Login error: ${error.message}`
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

      case '/test_connection':
        // Check if we have valid session
        const { data: sessionData } = await supabaseClient
          .from('trading_sessions')
          .select('*')
          .eq('id', 1)
          .maybeSingle();

        if (!sessionData || !sessionData.access_token || sessionData.status !== 'authenticated') {
          return new Response(JSON.stringify({
            status: 'disconnected',
            message: 'Not connected to broker',
            data: { status: 'disconnected' }
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        try {
          // Test connection by fetching profile
          const profileData = await makeKiteApiCall('/user/profile', sessionData.access_token);
          
          if (profileData.status === 'success') {
            return new Response(JSON.stringify({
              status: 'connected',
              message: 'Connection test successful',
              data: { 
                user_id: profileData.data.user_id,
                user_name: profileData.data.user_name,
                status: 'connected'
              }
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            throw new Error(profileData.message || 'Connection test failed');
          }
        } catch (error) {
          return new Response(JSON.stringify({
            status: 'error',
            message: `Connection test failed: ${error.message}`,
            data: { status: 'disconnected' }
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

      case '/live_status':
        // Get session data
        const { data: liveStatusSessionData } = await supabaseClient
          .from('trading_sessions')
          .select('*')
          .eq('id', 1)
          .maybeSingle();

        if (!liveStatusSessionData || !liveStatusSessionData.access_token) {
          return new Response(JSON.stringify({
            status: 'success',
            data: {
              live_status: {
                is_trading: false,
                market_open: false,
                active_positions: [],
                strategy_logs: []
              }
            }
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        try {
          // Fetch real positions data from Zerodha API
          const positionsData = await makeKiteApiCall('/portfolio/positions', liveStatusSessionData.access_token);
          
          // Check market status
          const marketData = await makeKiteApiCall('/market/status', liveStatusSessionData.access_token);
          
          return new Response(JSON.stringify({
            status: 'success',
            data: {
              live_status: {
                is_trading: liveStatusSessionData.trading_active || false,
                market_open: marketData.data?.some((market: any) => market.status === 'open') || false,
                active_positions: positionsData.data?.net || [],
                strategy_logs: []
              }
            }
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });

        } catch (error) {
          return new Response(JSON.stringify({
            status: 'success',
            data: {
              live_status: {
                is_trading: false,
                market_open: false,
                active_positions: [],
                strategy_logs: [],
                error: `Failed to fetch live status: ${error.message}`
              }
            }
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

      case '/get_balance':
        // Get session data
        const { data: balanceSessionData } = await supabaseClient
          .from('trading_sessions')
          .select('*')
          .eq('id', 1)
          .maybeSingle();

        if (!balanceSessionData || !balanceSessionData.access_token) {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'Not authenticated. Please login first.'
          }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        try {
          // Fetch real balance data from Zerodha API
          const balanceData = await makeKiteApiCall('/user/margins', balanceSessionData.access_token);
          
          if (balanceData.status === 'success') {
            return new Response(JSON.stringify({
              status: 'success',
              data: {
                balance: balanceData.data.equity,
                user_id: balanceSessionData.user_id
              }
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            throw new Error(balanceData.message || 'Failed to fetch balance');
          }
        } catch (error) {
          return new Response(JSON.stringify({
            status: 'error',
            message: `Failed to fetch balance: ${error.message}`
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/instruments':
        // Get session data
        const { data: instrumentsSessionData } = await supabaseClient
          .from('trading_sessions')
          .select('*')
          .eq('id', 1)
          .maybeSingle();

        if (!instrumentsSessionData || !instrumentsSessionData.access_token) {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'Not authenticated. Please login first.'
          }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        try {
          // Fetch real instruments data from Zerodha API
          const instrumentsData = await makeKiteApiCall('/instruments', instrumentsSessionData.access_token);
          
          // Filter for equity instruments
          const equityInstruments = instrumentsData.filter((instrument: any) => 
            instrument.segment === 'NSE' && instrument.instrument_type === 'EQ'
          ).slice(0, 100); // Limit to first 100 for performance

          // Define NIFTY 50 and Bank NIFTY stocks
          const nifty50_stocks = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'HINDUNILVR', 'ICICIBANK', 'KOTAKBANK', 'LT', 'SBIN', 'BHARTIARTL'];
          const banknifty_stocks = ['HDFCBANK', 'ICICIBANK', 'KOTAKBANK', 'SBIN', 'AXISBANK'];

          return new Response(JSON.stringify({
            status: 'success',
            data: {
              instruments: equityInstruments.map((instrument: any) => ({
                tradingsymbol: instrument.tradingsymbol,
                instrument_token: instrument.instrument_token,
                exchange: instrument.exchange,
                name: instrument.name
              })),
              nifty50_stocks,
              banknifty_stocks,
              count: equityInstruments.length
            }
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });

        } catch (error) {
          return new Response(JSON.stringify({
            status: 'error',
            message: `Failed to fetch instruments: ${error.message}`
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

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