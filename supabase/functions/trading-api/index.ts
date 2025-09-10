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