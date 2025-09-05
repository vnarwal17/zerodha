-- Fix search path security warnings for functions
-- Update all functions to have secure search_path

-- Update generate_session_hash function
CREATE OR REPLACE FUNCTION public.generate_session_hash()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN encode(gen_random_bytes(32), 'hex');
END;
$$;

-- Update is_session_valid function
CREATE OR REPLACE FUNCTION public.is_session_valid(session_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
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

-- Update cleanup_expired_sessions function
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- Update update_session_activity function
CREATE OR REPLACE FUNCTION public.update_session_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.last_activity = now();
  RETURN NEW;
END;
$$;