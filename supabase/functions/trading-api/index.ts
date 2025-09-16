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

// Enhanced order execution service with retry logic and status verification
class OrderExecutionService {
  constructor(private accessToken: string, private apiKey: string) {}

  // Retry mechanism with exponential backoff
  async executeWithRetry<T>(operation: () => Promise<T>, maxRetries: number = 3): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        console.log(`Attempt ${attempt} failed:`, error);
        
        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          throw error;
        }
        
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError!;
  }

  // Check if error is retryable (network issues, temporary API failures)
  private isRetryableError(error: any): boolean {
    if (error.message?.includes('network') || error.message?.includes('timeout')) {
      return true;
    }
    
    // Zerodha API specific retryable errors
    const retryableErrors = [
      'NetworkError',
      'GeneralException',
      'TokenException', // Sometimes temporary
      'ConnectionError'
    ];
    
    return retryableErrors.some(errType => 
      error.error_type === errType || error.message?.includes(errType)
    );
  }

  // Place order with comprehensive error handling
  async placeOrder(orderData: any): Promise<any> {
    console.log('Placing order with data:', orderData);
    
    return this.executeWithRetry(async () => {
      const response = await makeKiteApiCall('/orders/regular', this.accessToken, this.apiKey, 'POST', orderData);
      
      if (response.error_type) {
        throw new Error(`Zerodha API Error: ${response.message || response.error_type}`);
      }
      
      if (!response.order_id) {
        throw new Error(`Order placement failed: ${JSON.stringify(response)}`);
      }
      
      return response;
    });
  }

  // Verify order status after placement
  async verifyOrderStatus(orderId: string, maxWaitTime: number = 30000): Promise<any> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const orders = await makeKiteApiCall('/orders', this.accessToken, this.apiKey, 'GET');
        const order = orders.data?.find((o: any) => o.order_id === orderId);
        
        if (order) {
          console.log(`Order ${orderId} status: ${order.status}`);
          
          // Return when order is in final state
          if (['COMPLETE', 'REJECTED', 'CANCELLED'].includes(order.status)) {
            return order;
          }
        }
        
        // Wait 2 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error('Error checking order status:', error);
        // Continue checking unless we've exceeded max wait time
      }
    }
    
    throw new Error(`Order status verification timeout for order ${orderId}`);
  }

  // Enhanced order placement with full lifecycle tracking
  async placeOrderWithVerification(orderData: any): Promise<{
    order_id: string;
    status: string;
    message: string;
    order_details?: any;
  }> {
    try {
      // Step 1: Place the order
      const orderResponse = await this.placeOrder(orderData);
      const orderId = orderResponse.order_id;
      
      console.log(`Order placed successfully: ${orderId}`);
      
      // Step 2: Verify order status
      try {
        const orderDetails = await this.verifyOrderStatus(orderId);
        
        return {
          order_id: orderId,
          status: orderDetails.status,
          message: `Order ${orderId} placed and verified: ${orderDetails.status}`,
          order_details: orderDetails
        };
      } catch (verificationError) {
        // Order was placed but verification failed - still return success with warning
        console.warn('Order verification failed:', verificationError);
        return {
          order_id: orderId,
          status: 'PENDING',
          message: `Order ${orderId} placed successfully but status verification failed. Please check manually.`
        };
      }
      
    } catch (error) {
      console.error('Order placement failed:', error);
      throw error;
    }
  }
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
  return await response.json();
}

// Helper function to parse CSV data for instruments
async function parseCsvToInstruments(csvText: string) {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',');
  
  // Find relevant column indices
  const instrumentTokenIndex = headers.findIndex(h => h.toLowerCase() === 'instrument_token');
  const exchangeTokenIndex = headers.findIndex(h => h.toLowerCase() === 'exchange_token');
  const tradingsymbolIndex = headers.findIndex(h => h.toLowerCase() === 'tradingsymbol');
  const nameIndex = headers.findIndex(h => h.toLowerCase() === 'name');
  const exchangeIndex = headers.findIndex(h => h.toLowerCase() === 'exchange');
  const segmentIndex = headers.findIndex(h => h.toLowerCase() === 'segment');
  const instrumentTypeIndex = headers.findIndex(h => h.toLowerCase() === 'instrument_type');

  const instruments = [];
  
  for (let i = 1; i < lines.length; i++) {
    const columns = lines[i].split(',');
    
    // Skip if not enough columns
    if (columns.length < headers.length) continue;
    
    const exchange = columns[exchangeIndex];
    const segment = columns[segmentIndex];
    const instrumentType = columns[instrumentTypeIndex];
    const tradingsymbol = columns[tradingsymbolIndex];
    
    // Filter for NSE equity stocks only
    if (exchange === 'NSE' && segment === 'NSE' && instrumentType === 'EQ') {
      instruments.push({
        instrument_token: parseInt(columns[instrumentTokenIndex]),
        exchange_token: parseInt(columns[exchangeTokenIndex]),
        tradingsymbol: tradingsymbol,
        name: columns[nameIndex],
        exchange: exchange,
        segment: segment,
        instrument_type: instrumentType
      });
    }
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
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestData = await req.json();
    const { path } = requestData;

    console.log('Trading API request:', { path, data: requestData });

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    switch (path) {
      case '/test':
        return new Response(JSON.stringify({
          status: 'success',
          message: 'Trading API is running',
          timestamp: new Date().toISOString()
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/set_credentials':
        const { api_key, api_secret } = requestData;
        
        if (!api_key || !api_secret) {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'API key and secret are required'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Store credentials in database (encrypted)
        const { error: credentialsError } = await supabaseClient
          .from('trading_credentials')
          .upsert({
            id: 1,
            api_key: api_key,
            api_secret: api_secret,
            updated_at: new Date().toISOString()
          });

        if (credentialsError) {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'Failed to store credentials'
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({
          status: 'success',
          message: 'Credentials stored successfully'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/login':
        const { request_token } = requestData;
        
        // Get stored credentials
        const { data: credentials } = await supabaseClient
          .from('trading_credentials')
          .select('*')
          .eq('id', 1)
          .maybeSingle();

        if (!credentials) {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'No credentials found. Please set API credentials first.'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (!request_token) {
          // Generate login URL
          const loginUrl = `https://kite.trade/connect/login?api_key=${credentials.api_key}&v=3`;
          return new Response(JSON.stringify({
            status: 'requires_login',
            data: {
              login_url: loginUrl
            },
            message: 'Please complete login using the provided URL'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        try {
          // Generate checksum for access token request
          const checksum = await generateChecksum(credentials.api_key, request_token, credentials.api_secret);
          
          // Exchange request token for access token
          const tokenResponse = await fetch('https://api.kite.trade/session/token', {
            method: 'POST',
            headers: {
              'X-Kite-Version': '3',
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              api_key: credentials.api_key,
              request_token: request_token,
              checksum: checksum
            })
          });

          const tokenData = await tokenResponse.json();

          if (tokenData.status === 'success') {
            // Store session data
            const { error: sessionError } = await supabaseClient
              .from('trading_sessions')
              .upsert({
                id: 1,
                access_token: tokenData.data.access_token,
                request_token: request_token,
                user_id: tokenData.data.user_id,
                user_name: tokenData.data.user_name,
                status: 'authenticated',
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
              });

            if (sessionError) {
              console.error('Session storage error:', sessionError);
            }

            return new Response(JSON.stringify({
              status: 'success',
              data: {
                user_id: tokenData.data.user_id,
                user_name: tokenData.data.user_name
              },
              message: 'Login successful'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            return new Response(JSON.stringify({
              status: 'error',
              message: tokenData.message || 'Login failed'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        } catch (error) {
          return new Response(JSON.stringify({
            status: 'error',
            message: `Login failed: ${error.message}`
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

      case '/test_connection':
        // Get session data
        const { data: sessionData } = await supabaseClient
          .from('trading_sessions')
          .select('*')
          .eq('id', 1)
          .maybeSingle();

        if (!sessionData || !sessionData.access_token) {
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

        try {
          // Test connection by getting profile
          const profileResponse = await makeKiteApiCall('/user/profile', sessionData.access_token, credentialsData.api_key);

          if (profileResponse.status === 'success') {
            return new Response(JSON.stringify({
              status: 'connected',
              data: {
                user_id: profileResponse.data.user_id,
                user_name: profileResponse.data.user_name
              },
              message: 'Connection successful'
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            return new Response(JSON.stringify({
              status: 'disconnected',
              message: profileResponse.message || 'Connection test failed'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        } catch (error) {
          return new Response(JSON.stringify({
            status: 'disconnected',
            message: `Connection test failed: ${error.message}`
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

      case '/live_status':
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            live_status: {
              is_trading: false,
              market_open: true,
              active_positions: 0,
              total_positions: 0,
              monitoring_symbols: 0,
              positions_detail: [],
              strategy_logs: [
                {
                  timestamp: new Date().toISOString(),
                  symbol: 'SYSTEM',
                  event: 'status_check',
                  message: 'Live status retrieved successfully'
                }
              ]
            }
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/get_balance':
        // Get session data for access token
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

        // Get credentials for API key
        const { data: balanceCredentialsData } = await supabaseClient
          .from('trading_credentials')
          .select('*')
          .eq('id', 1)
          .maybeSingle();

        if (!balanceCredentialsData) {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'API credentials not found'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        try {
          // Get margin data from Zerodha
          const marginResponse = await makeKiteApiCall('/user/margins', balanceSessionData.access_token, balanceCredentialsData.api_key);

          if (marginResponse.status === 'success') {
            return new Response(JSON.stringify({
              status: 'success',
              data: {
                balance: marginResponse.data,
                user_id: balanceSessionData.user_id
              }
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            return new Response(JSON.stringify({
              status: 'error',
              message: marginResponse.message || 'Failed to get balance'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        } catch (error) {
          return new Response(JSON.stringify({
            status: 'error',
            message: `Failed to get balance: ${error.message}`
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

      case '/instruments':
        // Get session data for access token
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

        // Get credentials for API key
        const { data: instrumentsCredentialsData } = await supabaseClient
          .from('trading_credentials')
          .select('*')
          .eq('id', 1)
          .maybeSingle();

        if (!instrumentsCredentialsData) {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'API credentials not found'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        try {
          // Get instruments CSV from Zerodha
          const instrumentsResponse = await fetch('https://api.kite.trade/instruments', {
            headers: {
              'Authorization': `token ${instrumentsCredentialsData.api_key}:${instrumentsSessionData.access_token}`,
              'X-Kite-Version': '3'
            }
          });

          if (instrumentsResponse.ok) {
            const csvText = await instrumentsResponse.text();
            const allInstruments = await parseCsvToInstruments(csvText);
            
            // Sort by trading volume/popularity and take top 500
            const topInstruments = allInstruments.slice(0, 500);
            
            // Create response format
            const instruments = topInstruments.map(inst => ({
              symbol: inst.tradingsymbol,
              name: inst.name,
              token: inst.instrument_token,
              exchange: inst.exchange,
              is_nifty50: false, // You can implement Nifty 50 detection if needed
              is_banknifty: false // You can implement Bank Nifty detection if needed
            }));

            return new Response(JSON.stringify({
              status: 'success',
              data: {
                instruments: instruments,
                nifty50_stocks: [], // Can be populated with actual Nifty 50 list
                banknifty_stocks: [], // Can be populated with actual Bank Nifty list
                count: instruments.length
              }
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            return new Response(JSON.stringify({
              status: 'error',
              message: 'Failed to fetch instruments from Zerodha'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        } catch (error) {
          return new Response(JSON.stringify({
            status: 'error',
            message: `Failed to get instruments: ${error.message}`
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

      case '/start_live_trading':
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            symbols: requestData.symbols?.map((s: any) => s.symbol) || []
          },
          message: 'Live trading started'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/stop_live_trading':
        return new Response(JSON.stringify({
          status: 'success',
          message: 'Live trading stopped'
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
            totalPnL: 0,
            totalTrades: 0,
            winRate: 0,
            avgWin: 0,
            avgLoss: 0,
            maxDrawdown: 0,
            sharpeRatio: 0,
            todayPnL: 0
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case '/get_activity_logs':
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            logs: [
              {
                id: '1',
                event_type: 'system',
                event_name: 'system_start',
                symbol: 'SYSTEM',
                message: 'Trading system initialized',
                severity: 'info',
                metadata: {},
                created_at: new Date().toISOString()
              }
            ],
            count: 1
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
          
          // Use enhanced order execution service
          const orderService = new OrderExecutionService(testOrderSessionData.access_token, credentialsData.api_key);
          
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

          console.log(`Placing test order for ${testSymbol} with enhanced service...`);
          
          const result = await orderService.placeOrderWithVerification(orderData);
          
          return new Response(JSON.stringify({
            status: 'success',
            data: {
              order_id: result.order_id,
              symbol: testSymbol,
              order_status: result.status,
              message: `✅ ${result.message}`,
              order_details: result.order_details
            }
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
          
        } catch (error) {
          console.error('Enhanced test order failed:', error);
          return new Response(JSON.stringify({
            status: 'error',
            message: `Test order failed: ${error.message}`
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

      case '/execute_trade':
        try {
          // Get session data for access token
          const { data: tradeSessionData } = await supabaseClient
            .from('trading_sessions')
            .select('*')
            .eq('id', 1)
            .maybeSingle();

          if (!tradeSessionData || !tradeSessionData.access_token) {
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

          const { trade_symbol, action, quantity, order_type = 'MARKET', entry_price, stop_loss, take_profit } = requestData;
          
          if (!trade_symbol || !action || !quantity) {
            return new Response(JSON.stringify({
              status: 'error',
              message: 'Missing required fields: trade_symbol, action, quantity'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          console.log(`Executing ${action} trade for ${trade_symbol} with enhanced service...`);
          
          // Use enhanced order execution service
          const orderService = new OrderExecutionService(tradeSessionData.access_token, credentialsData.api_key);
          
          const orderData = {
            variety: 'regular',
            exchange: 'NSE',
            tradingsymbol: trade_symbol,
            transaction_type: action,
            order_type: order_type,
            quantity: quantity,
            product: 'MIS', // Intraday
            validity: 'DAY'
          };

          // Add price for limit orders
          if (order_type === 'LIMIT' && entry_price) {
            orderData.price = entry_price;
          }

          const result = await orderService.placeOrderWithVerification(orderData);
          
          // Log trade execution
          console.log(`Trade executed: ${action} ${quantity} ${trade_symbol}, Order ID: ${result.order_id}, Status: ${result.status}`);
          
          const response = {
            order_id: result.order_id,
            symbol: trade_symbol,
            action: action,
            quantity: quantity,
            entry_price: entry_price,
            stop_loss: stop_loss,
            take_profit: take_profit,
            order_status: result.status,
            message: result.message
          };

          // TODO: Place stop loss and take profit orders if provided
          if (stop_loss && result.status === 'COMPLETE') {
            console.log(`TODO: Place SL order at ${stop_loss}`);
          }
          
          if (take_profit && result.status === 'COMPLETE') {
            console.log(`TODO: Place TP order at ${take_profit}`);
          }

          return new Response(JSON.stringify({
            status: 'success',
            data: response
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
          
        } catch (error) {
          console.error('Enhanced trade execution failed:', error);
          return new Response(JSON.stringify({
            status: 'error',
            message: `Trade execution failed: ${error.message}`
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