-- Fix critical security vulnerability in trading_credentials table
-- Remove ALL existing overly permissive RLS policies that allow public access

-- Drop ALL existing policies first
DROP POLICY IF EXISTS "Allow all operations on trading_credentials" ON public.trading_credentials;
DROP POLICY IF EXISTS "Users can view their own trading credentials" ON public.trading_credentials;
DROP POLICY IF EXISTS "Users can insert their own trading credentials" ON public.trading_credentials;
DROP POLICY IF EXISTS "Users can update their own trading credentials" ON public.trading_credentials;
DROP POLICY IF EXISTS "Users can delete their own trading credentials" ON public.trading_credentials;

-- Create secure RLS policies for trading_credentials that require authentication
CREATE POLICY "Authenticated users can manage trading credentials" 
ON public.trading_credentials 
FOR ALL 
USING (auth.uid() IS NOT NULL);

-- Fix other trading tables
DROP POLICY IF EXISTS "Allow all operations on trading_sessions" ON public.trading_sessions;
DROP POLICY IF EXISTS "Authenticated users can manage trading sessions" ON public.trading_sessions;

CREATE POLICY "Authenticated users can manage trading sessions" 
ON public.trading_sessions 
FOR ALL 
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Allow all operations on trading_settings" ON public.trading_settings;
DROP POLICY IF EXISTS "Authenticated users can manage trading settings" ON public.trading_settings;

CREATE POLICY "Authenticated users can manage trading settings" 
ON public.trading_settings 
FOR ALL 
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Allow all operations on trading_positions" ON public.trading_positions;
DROP POLICY IF EXISTS "Authenticated users can manage trading positions" ON public.trading_positions;

CREATE POLICY "Authenticated users can manage trading positions" 
ON public.trading_positions 
FOR ALL 
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Allow all operations on trading_logs" ON public.trading_logs;
DROP POLICY IF EXISTS "Authenticated users can view trading logs" ON public.trading_logs;
DROP POLICY IF EXISTS "System can insert trading logs" ON public.trading_logs;

CREATE POLICY "Authenticated users can view trading logs" 
ON public.trading_logs 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert trading logs" 
ON public.trading_logs 
FOR INSERT 
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations on trade_logs" ON public.trade_logs;
DROP POLICY IF EXISTS "Authenticated users can view trade logs" ON public.trade_logs;
DROP POLICY IF EXISTS "System can insert trade logs" ON public.trade_logs;

CREATE POLICY "Authenticated users can view trade logs" 
ON public.trade_logs 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert trade logs" 
ON public.trade_logs 
FOR INSERT 
WITH CHECK (true);