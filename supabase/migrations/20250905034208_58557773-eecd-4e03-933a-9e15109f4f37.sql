-- Enhance trading_sessions table security
-- Add encryption and security features for session tokens

-- Add security columns to trading_sessions table
ALTER TABLE public.trading_sessions 
ADD COLUMN encrypted_access_token TEXT,
ADD COLUMN encrypted_request_token TEXT,
ADD COLUMN session_hash TEXT,
ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN last_activity TIMESTAMP WITH TIME ZONE DEFAULT now(),
ADD COLUMN ip_address TEXT,
ADD COLUMN user_agent TEXT,
ADD COLUMN token_version INTEGER DEFAULT 1;

-- Create index for performance on session lookups
CREATE INDEX idx_trading_sessions_hash ON public.trading_sessions(session_hash);
CREATE INDEX idx_trading_sessions_expires ON public.trading_sessions(expires_at);

-- Create function to generate secure session hash
CREATE OR REPLACE FUNCTION public.generate_session_hash()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN encode(gen_random_bytes(32), 'hex');
END;
$$;

-- Create function to check session validity
CREATE OR REPLACE FUNCTION public.is_session_valid(session_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  session_record RECORD;
BEGIN
  SELECT expires_at, status INTO session_record
  FROM public.trading_sessions
  WHERE id = session_id;
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  -- Check if session is expired or not authenticated
  IF session_record.expires_at < now() OR session_record.status != 'authenticated' THEN
    RETURN FALSE;
  END IF;
  
  RETURN TRUE;
END;
$$;

-- Create function to cleanup expired sessions
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cleanup_count INTEGER;
BEGIN
  UPDATE public.trading_sessions
  SET 
    status = 'expired',
    encrypted_access_token = NULL,
    encrypted_request_token = NULL,
    access_token = NULL,
    request_token = NULL
  WHERE expires_at < now() AND status = 'authenticated';
  
  GET DIAGNOSTICS cleanup_count = ROW_COUNT;
  RETURN cleanup_count;
END;
$$;

-- Create trigger to automatically update last_activity
CREATE OR REPLACE FUNCTION public.update_session_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.last_activity = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_trading_sessions_activity
  BEFORE UPDATE ON public.trading_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_session_activity();

-- Set default expiration for existing sessions (24 hours from now)
UPDATE public.trading_sessions
SET expires_at = now() + INTERVAL '24 hours'
WHERE expires_at IS NULL;