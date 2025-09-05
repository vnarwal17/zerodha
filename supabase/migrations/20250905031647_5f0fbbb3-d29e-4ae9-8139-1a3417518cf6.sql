-- Add encryption capabilities to trading_credentials table
-- Add new columns for encrypted data and mark old columns as deprecated

-- Add encrypted columns 
ALTER TABLE public.trading_credentials 
ADD COLUMN encrypted_api_key TEXT,
ADD COLUMN encrypted_api_secret TEXT,
ADD COLUMN encryption_version INTEGER DEFAULT 1;

-- Create function to safely migrate existing credentials
CREATE OR REPLACE FUNCTION public.migrate_credentials_to_encrypted()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- This will be handled by the edge function during first access
  -- Just mark that migration is needed
  UPDATE public.trading_credentials 
  SET encryption_version = 0 
  WHERE encrypted_api_key IS NULL OR encrypted_api_secret IS NULL;
END;
$$;

-- Run the migration marker
SELECT public.migrate_credentials_to_encrypted();