-- Create a comprehensive activity log table for all trading activities
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id BIGINT,
  event_type TEXT NOT NULL, -- CONNECTION, ANALYSIS, SIGNAL, ORDER, POSITION, SYSTEM, ERROR
  event_name TEXT NOT NULL, -- CONNECTED, SETUP_LONG, BUY_SIGNAL, ORDER_PLACED, etc.
  symbol TEXT,
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  severity TEXT DEFAULT 'info', -- info, success, warning, error
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create index for fast querying
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_event_type ON public.activity_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_symbol ON public.activity_logs(symbol);

-- Enable RLS
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Allow all operations since this is a system table for logging
CREATE POLICY "Allow all operations on activity_logs" ON public.activity_logs FOR ALL USING (true) WITH CHECK (true);