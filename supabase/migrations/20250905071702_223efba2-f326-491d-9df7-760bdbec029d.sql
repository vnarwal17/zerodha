-- Add quantity field to trading_settings table for user-configurable quantity
ALTER TABLE public.trading_settings 
ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 2;

-- Create table for tracking daily rejection states per symbol
CREATE TABLE IF NOT EXISTS public.daily_rejection_states (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol text NOT NULL,
  trade_date date NOT NULL DEFAULT CURRENT_DATE,
  rejection_candle_found boolean DEFAULT false,
  rejection_candle_timestamp timestamp with time zone,
  rejection_candle_data jsonb,
  setup_candle_data jsonb,
  sma_level numeric,
  invalidated boolean DEFAULT false,
  invalidation_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(symbol, trade_date)
);

-- Enable RLS on daily_rejection_states
ALTER TABLE public.daily_rejection_states ENABLE ROW LEVEL SECURITY;

-- Create policies for daily_rejection_states
CREATE POLICY "Allow all operations on daily_rejection_states" 
ON public.daily_rejection_states 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Add trigger for automatic timestamp updates on daily_rejection_states
CREATE TRIGGER update_daily_rejection_states_updated_at
BEFORE UPDATE ON public.daily_rejection_states
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to cleanup old rejection state data (older than 30 days)
CREATE OR REPLACE FUNCTION public.cleanup_old_rejection_states()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  cleanup_count INTEGER;
BEGIN
  DELETE FROM public.daily_rejection_states
  WHERE trade_date < CURRENT_DATE - INTERVAL '30 days';
  
  GET DIAGNOSTICS cleanup_count = ROW_COUNT;
  RETURN cleanup_count;
END;
$function$;