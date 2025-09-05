-- Fix critical security vulnerability in trading_credentials table
-- Remove the overly permissive RLS policy that allows public access

-- Drop the existing dangerous policy
DROP POLICY IF EXISTS "Allow all operations on trading_credentials" ON public.trading_credentials;

-- Create secure RLS policies for trading_credentials
-- Only allow authenticated users to access their own credentials
CREATE POLICY "Users can view their own trading credentials" 
ON public.trading_credentials 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert their own trading credentials" 
ON public.trading_credentials 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update their own trading credentials" 
ON public.trading_credentials 
FOR UPDATE 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can delete their own trading credentials" 
ON public.trading_credentials 
FOR DELETE 
USING (auth.uid() IS NOT NULL);

-- Also secure the other trading tables while we're at it
-- Fix trading_sessions table
DROP POLICY IF EXISTS "Allow all operations on trading_sessions" ON public.trading_sessions;

CREATE POLICY "Authenticated users can manage trading sessions" 
ON public.trading_sessions 
FOR ALL 
USING (auth.uid() IS NOT NULL);

-- Fix trading_settings table  
DROP POLICY IF EXISTS "Allow all operations on trading_settings" ON public.trading_settings;

CREATE POLICY "Authenticated users can manage trading settings" 
ON public.trading_settings 
FOR ALL 
USING (auth.uid() IS NOT NULL);

-- Fix trading_positions table
DROP POLICY IF EXISTS "Allow all operations on trading_positions" ON public.trading_positions;

CREATE POLICY "Authenticated users can manage trading positions" 
ON public.trading_positions 
FOR ALL 
USING (auth.uid() IS NOT NULL);

-- Fix trading_logs table
DROP POLICY IF EXISTS "Allow all operations on trading_logs" ON public.trading_logs;

CREATE POLICY "Authenticated users can view trading logs" 
ON public.trading_logs 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert trading logs" 
ON public.trading_logs 
FOR INSERT 
WITH CHECK (true);

-- Fix trade_logs table
DROP POLICY IF EXISTS "Allow all operations on trade_logs" ON public.trade_logs;

CREATE POLICY "Authenticated users can view trade logs" 
ON public.trade_logs 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert trade logs" 
ON public.trade_logs 
FOR INSERT 
WITH CHECK (true);