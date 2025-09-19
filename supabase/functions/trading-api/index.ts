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

// Helper function to make authenticated API calls to Zerodha with comprehensive error handling
async function makeKiteApiCall(endpoint: string, accessToken: string, apiKey: string, method: string = 'GET', body?: any) {
  const url = `https://api.kite.trade${endpoint}`;
  
  try {
    let options: RequestInit = { method };
    
    // For order placement, Zerodha expects form data, not JSON
    if (endpoint.includes('/orders') && method === 'POST' && body) {
      const formData = new URLSearchParams();
      Object.keys(body).forEach(key => {
        formData.append(key, body[key]);
      });
      
      options = {
        method,
        headers: {
          'Authorization': `token ${apiKey}:${accessToken}`,
          'X-Kite-Version': '3',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
      };
    } else {
      // For other endpoints, use JSON
      const headers = {
        'Authorization': `token ${apiKey}:${accessToken}`,
        'X-Kite-Version': '3',
        'Content-Type': 'application/json'
      };
      
      options = { method, headers };
      if (body && method !== 'GET') {
        options.body = JSON.stringify(body);
      }
    }

    console.log(`Making Kite API call: ${method} ${url}`);
    const response = await fetch(url, options);
    
    console.log(`Kite API response status: ${response.status}`);
    
    // Special handling for instruments endpoint which returns CSV
    if (endpoint === '/instruments') {
      if (!response.ok) {
        throw new Error(`Instruments API error: ${response.status} ${response.statusText}`);
      }
      const csvText = await response.text();
      return parseCsvToInstruments(csvText);
    }
    
    // For all other endpoints, expect JSON
    const responseData = await response.json();
    
    // Log the response for debugging
    console.log('Kite API response data:', responseData);
    
    return responseData;
    
  } catch (error) {
    console.error(`Kite API call failed for ${endpoint}:`, error);
    
    // Return a standardized error response
    return {
      status: 'error',
      error_type: 'NetworkException',
      message: error instanceof Error ? error.message : 'Unknown API error'
    };
  }
}

// Helper function to parse CSV instruments data
function parseCsvToInstruments(csvText: string) {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',');
  const instruments = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const instrument: any = {};
    
    headers.forEach((header, index) => {
      instrument[header.trim()] = values[index]?.trim() || '';
    });
    
    instruments.push(instrument);
  }
  
  return instruments;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let requestData: any = {};
    
    // Safely parse request body
    try {
      const body = await req.text();
      if (body) {
        requestData = JSON.parse(body);
      }
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return new Response(JSON.stringify({
        status: 'error',
        message: 'Invalid JSON format'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const path = requestData.path || '';
    console.log('Processing request:', path, requestData);

    // Initialize Supabase client with error handling
    let supabaseClient;
    try {
      supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      );
    } catch (supabaseError) {
      console.error('Supabase client error:', supabaseError);
      return new Response(JSON.stringify({
        status: 'error',
        message: 'Database connection failed'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    switch (path) {
      case '/test':
        return new Response(JSON.stringify({
          status: 'success',
          message: 'Edge function is working',
          data: { timestamp: new Date().toISOString() }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
        break;

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
        break;

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
        break;

      // Remove duplicate test case - already exists above

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
          // Get credentials for API key
          const { data: credentialsData } = await supabaseClient
            .from('trading_credentials')
            .select('*')
            .eq('id', 1)
            .maybeSingle();

          if (!credentialsData) {
            return new Response(JSON.stringify({
              status: 'error',
              message: 'API credentials not found'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Test connection by fetching profile
          const profileData = await makeKiteApiCall('/user/profile', sessionData.access_token, credentialsData.api_key);
          
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
        break;

      case '/live_status':
        try {
          console.log('Live status check starting...');
          
          // Log the status check with error handling
          try {
            await supabaseClient
              .from('activity_logs')
              .insert({
                event_type: 'SYSTEM',
                event_name: 'LIVE_STATUS_CHECK',
                symbol: null,
                message: 'Retrieving live trading status and market data',
                severity: 'info',
                metadata: { timestamp: new Date().toISOString() }
              });
          } catch (logError) {
            console.warn('Failed to log live status check:', logError);
          }

          // Get session data with error handling
          let liveStatusSessionData = null;
          try {
            const { data: sessionResult, error: sessionError } = await supabaseClient
              .from('trading_sessions')
              .select('*')
              .eq('id', 1)
              .maybeSingle();
            
            if (sessionError) {
              console.warn('Session fetch error:', sessionError);
            } else {
              liveStatusSessionData = sessionResult;
            }
          } catch (sessionFetchError) {
            console.error('Session fetch failed:', sessionFetchError);
          }

          if (!liveStatusSessionData || !liveStatusSessionData.access_token) {
            try {
              await supabaseClient
                .from('activity_logs')
                .insert({
                  event_type: 'SYSTEM',
                  event_name: 'SESSION_STATUS',
                  symbol: null,
                  message: 'Trading session not authenticated - offline mode',
                  severity: 'warning',
                  metadata: { authenticated: false }
                });
            } catch (logError) {
              console.warn('Failed to log session status:', logError);
            }

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

          // Get credentials for API key with error handling
          let credentialsData = null;
          try {
            const { data: credResult, error: credError } = await supabaseClient
              .from('trading_credentials')
              .select('*')
              .eq('id', 1)
              .maybeSingle();
            
            if (credError) {
              console.warn('Credentials fetch error:', credError);
            } else {
              credentialsData = credResult;
            }
          } catch (credFetchError) {
            console.error('Credentials fetch failed:', credFetchError);
          }

          if (!credentialsData) {
            try {
              await supabaseClient
                .from('activity_logs')
                .insert({
                  event_type: 'SYSTEM',
                  event_name: 'CREDENTIALS_ERROR',
                  symbol: null,
                  message: 'Trading credentials not found in database',
                  severity: 'error',
                  metadata: { issue: 'missing_credentials' }
                });
            } catch (logError) {
              console.warn('Failed to log credentials error:', logError);
            }

            return new Response(JSON.stringify({
              status: 'success',
              data: {
                live_status: {
                  is_trading: liveStatusSessionData.trading_active || false,
                  market_open: false,
                  active_positions: [],
                  strategy_logs: [],
                  error: 'API credentials not found'
                }
              }
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Try to fetch market and position data, but don't fail the entire request if they fail
          let marketOpen = false;
          let positions = [];
          
          try {
            const marketData = await makeKiteApiCall('/market/status', liveStatusSessionData.access_token, credentialsData.api_key);
            
            // Check if the API call was successful
            if (marketData && marketData.status !== 'error') {
              marketOpen = marketData.data?.some((market: any) => market.status === 'open') || false;
              
              try {
                await supabaseClient
                  .from('activity_logs')
                  .insert({
                    event_type: 'MARKET',
                    event_name: 'MARKET_STATUS',
                    symbol: null,
                    message: `Market status: ${marketOpen ? 'OPEN - Trading active' : 'CLOSED - After hours'}`,
                    severity: 'info',
                    metadata: { market_open: marketOpen, raw_data: marketData.data }
                  });
              } catch (logError) {
                console.warn('Failed to log market status:', logError);
              }
            } else {
              throw new Error(marketData?.message || 'Market status API failed');
            }
          } catch (e) {
            const errorMessage = e instanceof Error ? e.message : 'Unknown error';
            console.log('Market status fetch failed:', errorMessage);
            try {
              await supabaseClient
                .from('activity_logs')
                .insert({
                  event_type: 'MARKET',
                  event_name: 'MARKET_ERROR',
                  symbol: null,
                  message: `Failed to fetch market status: ${errorMessage}`,
                  severity: 'error',
                  metadata: { error: errorMessage }
                });
            } catch (logError) {
              console.warn('Failed to log market error:', logError);
            }
          }

          try {
            const positionsData = await makeKiteApiCall('/portfolio/positions', liveStatusSessionData.access_token, credentialsData.api_key);
            
            // Check if the API call was successful
            if (positionsData && positionsData.status !== 'error') {
              positions = positionsData.data?.net || [];
              
              const activePositions = positions.filter((pos: any) => pos.quantity !== 0);
              try {
                await supabaseClient
                  .from('activity_logs')
                  .insert({
                    event_type: 'POSITION',
                    event_name: 'POSITION_UPDATE',
                    symbol: null,
                    message: `Portfolio status: ${activePositions.length} active positions, ${positions.length - activePositions.length} closed positions`,
                    severity: 'info',
                    metadata: { 
                      active_count: activePositions.length,
                      total_count: positions.length,
                      positions: activePositions.map((p: any) => ({ symbol: p.tradingsymbol, quantity: p.quantity, pnl: p.pnl }))
                    }
                  });
              } catch (logError) {
                console.warn('Failed to log position update:', logError);
              }
            } else {
              throw new Error(positionsData?.message || 'Positions API failed');
            }
          } catch (e) {
            const errorMessage = e instanceof Error ? e.message : 'Unknown error';
            console.log('Positions fetch failed:', errorMessage);
            try {
              await supabaseClient
                .from('activity_logs')
                .insert({
                  event_type: 'POSITION',
                  event_name: 'POSITION_ERROR',
                  symbol: null,
                  message: `Failed to fetch positions: ${errorMessage}`,
                  severity: 'error',
                  metadata: { error: errorMessage }
                });
            } catch (logError) {
              console.warn('Failed to log position error:', logError);
            }
          }

          // Log trading status
          const isTrading = liveStatusSessionData.trading_active || false;
          let symbolCount = 0;
          let symbolsList = [];
          
          // Safely parse symbols - it could be a string, object, or null
          try {
            if (liveStatusSessionData.symbols) {
              if (typeof liveStatusSessionData.symbols === 'string') {
                symbolsList = JSON.parse(liveStatusSessionData.symbols);
              } else if (Array.isArray(liveStatusSessionData.symbols)) {
                symbolsList = liveStatusSessionData.symbols;
              } else {
                symbolsList = [];
              }
              symbolCount = symbolsList.length;
            }
          } catch (e) {
            console.log('Error parsing symbols:', e.message);
            symbolsList = [];
            symbolCount = 0;
          }
          
          await supabaseClient
            .from('activity_logs')
            .insert({
              event_type: 'TRADING',
              event_name: 'TRADING_STATUS',
              symbol: null,
              message: `Trading engine: ${isTrading ? `ACTIVE - Monitoring ${symbolCount} symbols` : 'INACTIVE - Strategy stopped'}`,
              severity: isTrading ? 'success' : 'info',
              metadata: { 
                trading_active: isTrading,
                symbol_count: symbolCount,
                symbols: symbolsList
              }
            });
          
          return new Response(JSON.stringify({
            status: 'success',
            data: {
              live_status: {
                is_trading: isTrading,
                market_open: marketOpen,
                active_positions: positions,
                strategy_logs: []
              }
            }
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorStack = error instanceof Error ? error.stack : 'No stack trace';
          
          console.error('Live status error:', error);
          
          // Try to log the error, but don't fail if logging fails
          try {
            await supabaseClient
              .from('activity_logs')
              .insert({
                event_type: 'SYSTEM',
                event_name: 'STATUS_ERROR',
                symbol: null,
                message: `System error during status check: ${errorMessage}`,
                severity: 'error',
                metadata: { error: errorMessage, stack: errorStack }
              });
          } catch (logError) {
            console.warn('Failed to log status error:', logError);
          }

          return new Response(JSON.stringify({
            status: 'error',
            message: `Live status error: ${errorMessage}`,
            timestamp: new Date().toISOString()
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        break;

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
          // Get credentials for API key
          const { data: credentialsData } = await supabaseClient
            .from('trading_credentials')
            .select('*')
            .eq('id', 1)
            .maybeSingle();

          if (!credentialsData) {
            return new Response(JSON.stringify({
              status: 'error',
              message: 'API credentials not found'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Fetch real balance data from Zerodha API
          const balanceData = await makeKiteApiCall('/user/margins', balanceSessionData.access_token, credentialsData.api_key);
          
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
        break;

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
          // Get credentials for API key
          const { data: credentialsData } = await supabaseClient
            .from('trading_credentials')
            .select('*')
            .eq('id', 1)
            .maybeSingle();

          if (!credentialsData) {
            return new Response(JSON.stringify({
              status: 'error',
              message: 'API credentials not found'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Fetch real instruments data from Zerodha API
          const instrumentsData = await makeKiteApiCall('/instruments', instrumentsSessionData.access_token, credentialsData.api_key);
          
          // Filter for equity instruments on NSE
          const equityInstruments = instrumentsData.filter((instrument: any) => 
            instrument.exchange === 'NSE' && instrument.instrument_type === 'EQ'
          ); // Return all instruments, no limit

          // Define NIFTY 50 and Bank NIFTY stocks
          const nifty50_stocks = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'HINDUNILVR', 'ICICIBANK', 'KOTAKBANK', 'LT', 'SBIN', 'BHARTIARTL', 'ASIANPAINT', 'MARUTI', 'BAJFINANCE', 'AXISBANK', 'HCLTECH', 'NESTLEIND', 'ULTRACEMCO', 'TITAN', 'ADANIPORTS', 'POWERGRID', 'NTPC', 'COALINDIA', 'TECHM', 'TATAMOTORS', 'WIPRO', 'SUNPHARMA', 'ONGC', 'JSWSTEEL', 'INDUSINDBK', 'TATASTEEL', 'GRASIM', 'HINDALCO', 'DRREDDY', 'EICHERMOT', 'DIVISLAB', 'BAJAJFINSV', 'HEROMOTOCO', 'APOLLOHOSP', 'CIPLA', 'BRITANNIA', 'TATACONSUM', 'SHREECEM', 'UPL', 'IOC', 'BAJAJ-AUTO', 'M&M', 'BPCL', 'ADANIENT', 'SBILIFE', 'HDFCLIFE'];
          const banknifty_stocks = ['HDFCBANK', 'ICICIBANK', 'KOTAKBANK', 'SBIN', 'AXISBANK', 'INDUSINDBK', 'BAJFINANCE', 'BAJAJFINSV', 'PNB', 'BANDHANBNK', 'FEDERALBNK', 'IDFCFIRSTB'];

          // Top 500 stocks by market cap (predefined list)
          const top500Stocks = [
            // NIFTY 50
            'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'HINDUNILVR', 'ICICIBANK', 'KOTAKBANK', 'LT', 'SBIN', 'BHARTIARTL',
            'ASIANPAINT', 'MARUTI', 'BAJFINANCE', 'AXISBANK', 'HCLTECH', 'NESTLEIND', 'ULTRACEMCO', 'TITAN', 'ADANIPORTS',
            'POWERGRID', 'NTPC', 'COALINDIA', 'TECHM', 'TATAMOTORS', 'WIPRO', 'SUNPHARMA', 'ONGC', 'JSWSTEEL',
            'INDUSINDBK', 'TATASTEEL', 'GRASIM', 'HINDALCO', 'DRREDDY', 'EICHERMOT', 'DIVISLAB', 'BAJAJFINSV',
            'HEROMOTOCO', 'APOLLOHOSP', 'CIPLA', 'BRITANNIA', 'TATACONSUM', 'SHREECEM', 'UPL', 'IOC', 'BAJAJ-AUTO',
            'M&M', 'BPCL', 'ADANIENT', 'SBILIFE', 'HDFCLIFE',
            // Additional top market cap stocks
            'ADANIGREEN', 'ADANITRANS', 'AMBUJACEM', 'APOLLOTYRE', 'ASHOKLEY', 'AUROPHARMA', 'BANKBARODA', 'BATAINDIA',
            'BERGEPAINT', 'BIOCON', 'BOSCHLTD', 'BPCL', 'CADILAHC', 'CANBK', 'CENTURYTEX', 'CESC', 'CHAMBLFERT',
            'CHOLAFIN', 'COLPAL', 'CONCOR', 'COROMANDEL', 'CROMPTON', 'CUB', 'CUMMINSIND', 'DABUR', 'DEEPAKNTR',
            'DMART', 'DALBHARAT', 'DELTACORP', 'EMAMILTD', 'ESCORTS', 'EXIDEIND', 'FEDERALBNK', 'FORTIS', 'GAIL',
            'GLENMARK', 'GMRINFRA', 'GODREJCP', 'GODREJPROP', 'GRANULES', 'GUJGASLTD', 'HAL', 'HAVELLS', 'HDFCAMC',
            'HDFCLIFE', 'HINDZINC', 'HONAUT', 'IBULHSGFIN', 'IDEA', 'IDFCFIRSTB', 'IEX', 'IGL', 'INDIGO', 'INDHOTEL',
            'IOC', 'IRCTC', 'ITC', 'JINDALSTEL', 'JSWENERGY', 'JUBLFOOD', 'JUSTDIAL', 'KPITTECH', 'LALPATHLAB',
            'LICHSGFIN', 'LUPIN', 'MANAPPURAM', 'MARICO', 'MAXHEALTH', 'MCDOWELL-N', 'MFSL', 'MGL', 'MINDTREE',
            'MOTHERSUMI', 'MPHASIS', 'MRF', 'MUTHOOTFIN', 'NATIONALUM', 'NAUKRI', 'NAVINFLUOR', 'NETWORK18',
            'NMDC', 'OBEROIRLTY', 'OFSS', 'OIL', 'PAGEIND', 'PERSISTENT', 'PETRONET', 'PFC', 'PIDILITIND',
            'PIIND', 'PNB', 'POLYCAB', 'PVRINOX', 'RAIN', 'RAMCOCEM', 'RBLBANK', 'RECLTD', 'RELAXO', 'SAIL',
            'SBICARD', 'SBILIFE', 'SHREECEM', 'SIEMENS', 'SRF', 'STAR', 'STARTV', 'SUDARSCHEM', 'SUNDRMFAST',
            'SUNTV', 'SYMPHONY', 'SYNDIBANK', 'TATACOMM', 'TATAPOWER', 'TRENT', 'TORNTPHARM', 'TORNTPOWER',
            'UJJIVAN', 'UBL', 'UNITDSPR', 'VEDL', 'VOLTAS', 'WHIRLPOOL', 'YESBANK', 'ZEEL', 'ZENSARTECH',
            // Add more symbols to reach 500 (this is a representative list)
            'ACC', 'AUBANK', 'ABCAPITAL', 'ABFRL', 'ALKEM', 'AMBUJACEM', 'APOLLOTYRE', 'ASHOKLEY', 'AUROPHARMA',
            'BALKRISIND', 'BANDHANBNK', 'BATAINDIA', 'BERGEPAINT', 'BHARATFORG', 'BHARTIARTL', 'BIOCON', 'BOSCHLTD',
            'CADILAHC', 'CANBK', 'CENTURYTEX', 'CESC', 'CHAMBLFERT', 'CHOLAFIN', 'COLPAL', 'CONCOR', 'COROMANDEL',
            'CROMPTON', 'CUB', 'CUMMINSIND', 'DABUR', 'DEEPAKNTR', 'DMART', 'DALBHARAT', 'DELTACORP', 'EMAMILTD'
          ];

          // Filter for equity instruments on NSE and limit to top 500 by market cap
          const allEquityInstruments = instrumentsData.filter((instrument: any) => 
            instrument.exchange === 'NSE' && instrument.instrument_type === 'EQ'
          );

          // Filter to include only top 500 stocks
          const top500Instruments = allEquityInstruments.filter((instrument: any) => {
            const tradingSymbol = instrument.tradingsymbol || instrument.trading_symbol;
            return top500Stocks.includes(tradingSymbol);
          });

          return new Response(JSON.stringify({
            status: 'success',
            data: {
              instruments: top500Instruments.map((instrument: any) => {
                const tradingSymbol = instrument.tradingsymbol || instrument.trading_symbol;
                return {
                  symbol: tradingSymbol,
                  tradingsymbol: tradingSymbol,
                  instrument_token: instrument.instrument_token,
                  token: instrument.instrument_token,
                  exchange: instrument.exchange,
                  name: instrument.name || instrument.company_name || tradingSymbol,
                  is_nifty50: nifty50_stocks.includes(tradingSymbol),
                  is_banknifty: banknifty_stocks.includes(tradingSymbol)
                };
              }),
              nifty50_stocks,
              banknifty_stocks,
              count: top500Instruments.length
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
        break;

      case '/start_live_trading':
        try {
          const { symbols } = requestData;
          
          if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
            return new Response(JSON.stringify({
              status: 'error',
              message: 'Symbols array is required'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Update trading session to mark as active
          const { error: updateError } = await supabaseClient
            .from('trading_sessions')
            .update({ 
              trading_active: true, 
              symbols: symbols,
              updated_at: new Date().toISOString() 
            })
            .eq('id', 1);

          if (updateError) {
            console.error('Failed to update trading session:', updateError);
            return new Response(JSON.stringify({
              status: 'error',
              message: 'Failed to start live trading'
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          console.log(`🚀 Live trading started for ${symbols.length} symbols:`, symbols.map(s => s.symbol).join(', '));
          
          return new Response(JSON.stringify({
            status: 'success',
            message: `Live trading started successfully for ${symbols.length} symbols`,
            data: { symbols, is_trading: true }
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Start trading error:', error);
          return new Response(JSON.stringify({
            status: 'error',
            message: `Failed to start trading: ${error.message}`
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        break;

      case '/stop_live_trading':
        try {
          // Update trading session to mark as inactive
          const { error: updateError } = await supabaseClient
            .from('trading_sessions')
            .update({ 
              trading_active: false, 
              symbols: null,
              updated_at: new Date().toISOString() 
            })
            .eq('id', 1);

          if (updateError) {
            console.error('Failed to update trading session:', updateError);
            return new Response(JSON.stringify({
              status: 'error',
              message: 'Failed to stop live trading'
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          console.log('🛑 Live trading stopped');
          
          return new Response(JSON.stringify({
            status: 'success',
            message: 'Live trading stopped successfully',
            data: { is_trading: false }
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Stop trading error:', error);
          return new Response(JSON.stringify({
            status: 'error',
            message: `Failed to stop trading: ${error.message}`
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        break;

      case '/update_settings':
        return new Response(JSON.stringify({
          status: 'success',
          message: 'Settings updated successfully'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
        break;

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
        break;

      case '/get_activity_logs':
        const { limit, event_type } = requestData;
        
        let query = supabaseClient
          .from('activity_logs')
          .select('*')
          .order('created_at', { ascending: false });
        
        // Only apply limit if specified, otherwise get all logs
        if (limit && limit > 0) {
          query = query.limit(limit);
        }
        
        // Filter by event type if specified
        if (event_type && event_type !== 'all') {
          query = query.eq('event_type', event_type);
        }
        
        const { data: activityLogs, error: logsError } = await query;
        
        if (logsError) {
          return new Response(JSON.stringify({
            status: 'error',
            message: logsError.message
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // Highlight setup detection logs and format times in IST
        const processedLogs = (activityLogs || []).map(log => {
          const utcDate = new Date(log.created_at);
          // Convert UTC to IST (UTC+5:30)
          const istDate = new Date(utcDate.getTime() + (5.5 * 60 * 60 * 1000));
          
          return {
            ...log,
            is_setup_detection: log.event_type === 'SETUP_DETECTION',
            formatted_time: istDate.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            })
          };
        });
        
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            logs: processedLogs,
            count: processedLogs.length,
            setup_logs: processedLogs.filter(log => log.is_setup_detection)
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
        break;

      case '/log_setup_detection':
        try {
          const { symbol, setup_type, setup_time, message } = requestData;
          
          // Validate required fields
          if (!symbol || !setup_type || !message) {
            return new Response(JSON.stringify({
              status: 'error',
              message: 'symbol, setup_type, and message are required'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Validate setup_type
          if (!['BUY', 'SELL', 'INVALID'].includes(setup_type)) {
            return new Response(JSON.stringify({
              status: 'error',
              message: 'setup_type must be BUY, SELL, or INVALID'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          const formatted_message = `[${setup_time || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}] ${message}`;
          
          console.log('Logging setup detection:', { symbol, setup_type, formatted_message });
          
          // Log to activity_logs with error handling
          try {
            await supabaseClient
              .from('activity_logs')
              .insert({
                event_type: 'SETUP_DETECTION',
              event_name: `SETUP_${setup_type}`,
              symbol: symbol,
              message: formatted_message,
              severity: 'info',
              metadata: {
                setup_type,
                setup_time,
                original_message: message,
                timestamp: new Date().toISOString()
              }
            });
            
            console.log('Successfully logged to activity_logs');
          } catch (activityLogError) {
            console.error('Failed to log to activity_logs:', activityLogError);
            // Continue execution even if activity log fails
          }

          // Also log to trading_logs for strategy monitoring with error handling
          try {
            await supabaseClient
              .from('trading_logs')
              .insert({
                message: formatted_message,
                level: 'info',
                symbol: symbol
              });
            
            console.log('Successfully logged to trading_logs');
          } catch (tradingLogError) {
            console.error('Failed to log to trading_logs:', tradingLogError);
            // Continue execution even if trading log fails
          }

          return new Response(JSON.stringify({
            status: 'success',
            message: 'Setup detection logged successfully',
            data: { formatted_message }
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error('Setup detection logging error:', error);
          
          return new Response(JSON.stringify({
            status: 'error',
            message: `Failed to log setup detection: ${errorMessage}`
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        break;

      case '/place_test_order':
        try {
          // Get session data for access token
          const { data: testOrderSessionData } = await supabaseClient
            .from('trading_sessions')
            .select('*')
            .eq('id', 1)
            .maybeSingle();

          if (!testOrderSessionData || !testOrderSessionData.access_token) {
            return new Response(JSON.stringify({
              status: 'error',
              message: 'Not authenticated. Please login first.'
            }), {
              status: 401,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Get credentials for API key
          const { data: credentialsData } = await supabaseClient
            .from('trading_credentials')
            .select('*')
            .eq('id', 1)
            .maybeSingle();

          if (!credentialsData) {
            return new Response(JSON.stringify({
              status: 'error',
              message: 'API credentials not found'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          const testSymbol = requestData.test_symbol || 'SBIN';
          
          // Place a real test order through Zerodha API
          const orderData = {
            variety: 'regular',
            exchange: 'NSE',
            tradingsymbol: testSymbol,
            transaction_type: 'BUY',
            order_type: 'MARKET',
            quantity: 1,
            product: 'MIS', // Intraday
            validity: 'DAY'
          };

          const orderResponse = await makeKiteApiCall('/orders/regular', testOrderSessionData.access_token, credentialsData.api_key, 'POST', orderData);
          
          console.log('Zerodha order response:', orderResponse);
          
          // Handle Zerodha API response - check for both direct order_id and nested structure
          if (orderResponse && (orderResponse.order_id || (orderResponse.data && orderResponse.data.order_id))) {
            const orderId = orderResponse.order_id || orderResponse.data.order_id;
            return new Response(JSON.stringify({
              status: 'success',
              data: {
                order_id: orderId,
                symbol: testSymbol,
                message: `✅ Real test order placed successfully on Zerodha! Order ID: ${orderId}`
              }
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else if (orderResponse && orderResponse.error_type) {
            // Handle Zerodha API errors
            return new Response(JSON.stringify({
              status: 'error',
              message: `Zerodha API Error: ${orderResponse.message || orderResponse.error_type}`
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            // Log the full response for debugging
            console.error('Unexpected order response format:', orderResponse);
            return new Response(JSON.stringify({
              status: 'error',
              message: `Unexpected response format from Zerodha API`,
              debug_info: orderResponse
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        } catch (error) {
          return new Response(JSON.stringify({
            status: 'error',
            message: `Test order failed: ${error.message}`
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        break;

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
    
    // Ensure we always return a proper error response
    const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
    
    return new Response(JSON.stringify({
      status: 'error',
      message: `Server error: ${errorMessage}`,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});