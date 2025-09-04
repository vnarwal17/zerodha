-- Create tables for trading backend functionality

-- Trading credentials table
CREATE TABLE public.trading_credentials (
  id BIGINT PRIMARY KEY DEFAULT 1,
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Trading sessions table  
CREATE TABLE public.trading_sessions (
  id BIGINT PRIMARY KEY DEFAULT 1,
  request_token TEXT,
  status TEXT DEFAULT 'disconnected',
  trading_active BOOLEAN DEFAULT false,
  symbols JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Trading settings table
CREATE TABLE public.trading_settings (
  id BIGINT PRIMARY KEY DEFAULT 1,
  settings JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Trading positions table
CREATE TABLE public.trading_positions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  entry_price DECIMAL(10,2) NOT NULL,
  current_price DECIMAL(10,2),
  pnl DECIMAL(10,2),
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Trading logs table
CREATE TABLE public.trading_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message TEXT NOT NULL,
  level TEXT DEFAULT 'info',
  symbol TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.trading_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_logs ENABLE ROW LEVEL SECURITY;

-- Create policies allowing full access (since this is a single-user trading app)
CREATE POLICY "Allow all operations on trading_credentials" ON public.trading_credentials FOR ALL USING (true);
CREATE POLICY "Allow all operations on trading_sessions" ON public.trading_sessions FOR ALL USING (true);
CREATE POLICY "Allow all operations on trading_settings" ON public.trading_settings FOR ALL USING (true);
CREATE POLICY "Allow all operations on trading_positions" ON public.trading_positions FOR ALL USING (true);
CREATE POLICY "Allow all operations on trading_logs" ON public.trading_logs FOR ALL USING (true);

-- Create trigger function for updating timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_trading_credentials_updated_at
  BEFORE UPDATE ON public.trading_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_trading_sessions_updated_at
  BEFORE UPDATE ON public.trading_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_trading_settings_updated_at
  BEFORE UPDATE ON public.trading_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_trading_positions_updated_at
  BEFORE UPDATE ON public.trading_positions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();