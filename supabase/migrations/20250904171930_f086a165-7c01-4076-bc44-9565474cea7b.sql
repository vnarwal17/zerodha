-- Update trading_sessions table to store access_token and user details
ALTER TABLE public.trading_sessions 
ADD COLUMN IF NOT EXISTS access_token TEXT,
ADD COLUMN IF NOT EXISTS user_id TEXT,
ADD COLUMN IF NOT EXISTS user_name TEXT,
ADD COLUMN IF NOT EXISTS login_time TEXT;