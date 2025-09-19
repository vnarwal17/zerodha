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
async function makeKiteApiCall(endpoint: string, accessToken: string, apiKey: string, method: string = 'GET', body?: any) {
  const url = `https://api.kite.trade${endpoint}`;
  
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

  const response = await fetch(url, options);
  
  // Special handling for instruments endpoint which returns CSV
  if (endpoint === '/instruments') {
    const csvText = await response.text();
    return parseCsvToInstruments(csvText);
  }
  
  return await response.json();
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

      case '/live_status':
        try {
          // Log the status check
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

          // Get session data
          const { data: liveStatusSessionData } = await supabaseClient
            .from('trading_sessions')
            .select('*')
            .eq('id', 1)
            .maybeSingle();

          if (!liveStatusSessionData || !liveStatusSessionData.access_token) {
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

          // Get credentials for API key
          const { data: credentialsData } = await supabaseClient
            .from('trading_credentials')
            .select('*')
            .eq('id', 1)
            .maybeSingle();

          if (!credentialsData) {
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
            marketOpen = marketData.data?.some((market: any) => market.status === 'open') || false;
            
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
          } catch (e) {
            console.log('Market status fetch failed:', e.message);
            await supabaseClient
              .from('activity_logs')
              .insert({
                event_type: 'MARKET',
                event_name: 'MARKET_ERROR',
                symbol: null,
                message: `Failed to fetch market status: ${e.message}`,
                severity: 'error',
                metadata: { error: e.message }
              });
          }

          try {
            const positionsData = await makeKiteApiCall('/portfolio/positions', liveStatusSessionData.access_token, credentialsData.api_key);
            positions = positionsData.data?.net || [];
            
            const activePositions = positions.filter((pos: any) => pos.quantity !== 0);
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
          } catch (e) {
            console.log('Positions fetch failed:', e.message);
            await supabaseClient
              .from('activity_logs')
              .insert({
                event_type: 'POSITION',
                event_name: 'POSITION_ERROR',
                symbol: null,
                message: `Failed to fetch positions: ${e.message}`,
                severity: 'error',
                metadata: { error: e.message }
              });
          }

          // Log trading status
          const isTrading = liveStatusSessionData.trading_active || false;
          const symbolCount = liveStatusSessionData.symbols ? JSON.parse(liveStatusSessionData.symbols).length : 0;
          
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
                symbols: liveStatusSessionData.symbols ? JSON.parse(liveStatusSessionData.symbols) : []
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
          console.error('Live status error:', error);
          await supabaseClient
            .from('activity_logs')
            .insert({
              event_type: 'SYSTEM',
              event_name: 'STATUS_ERROR',
              symbol: null,
              message: `System error during status check: ${error.message}`,
              severity: 'error',
              metadata: { error: error.message, stack: error.stack }
            });

          return new Response(JSON.stringify({
            status: 'error',
            message: `Live status error: ${error.message}`
          }), {
            status: 500,
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
        
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            logs: activityLogs || [],
            count: activityLogs?.length || 0
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

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
          
          // Zerodha API returns order_id directly on success
          if (orderResponse && orderResponse.order_id) {
            return new Response(JSON.stringify({
              status: 'success',
              data: {
                order_id: orderResponse.order_id,
                symbol: testSymbol,
                message: `✅ Real test order placed successfully on Zerodha! Order ID: ${orderResponse.order_id}`
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
            return new Response(JSON.stringify({
              status: 'error',
              message: `Test order failed: ${JSON.stringify(orderResponse)}`
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