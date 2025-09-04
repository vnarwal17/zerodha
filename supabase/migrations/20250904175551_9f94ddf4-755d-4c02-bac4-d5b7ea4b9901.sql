-- Create trade_logs table for tracking executed trades
CREATE TABLE IF NOT EXISTS public.trade_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL')),
  quantity INTEGER NOT NULL,
  price DECIMAL(10,2),
  order_id TEXT,
  order_type TEXT DEFAULT 'MARKET',
  status TEXT DEFAULT 'PLACED',
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.trade_logs ENABLE ROW LEVEL SECURITY;

-- Create policy for public access (since this is a single-user trading system)
CREATE POLICY "Allow all operations on trade_logs" 
ON public.trade_logs 
FOR ALL 
USING (true);

-- Create index for better query performance
CREATE INDEX idx_trade_logs_symbol ON public.trade_logs(symbol);
CREATE INDEX idx_trade_logs_timestamp ON public.trade_logs(timestamp);
CREATE INDEX idx_trade_logs_status ON public.trade_logs(status);