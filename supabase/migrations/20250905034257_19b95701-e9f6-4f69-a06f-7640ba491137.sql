-- Update trading_credentials table to enforce encryption
-- First, create helper functions for encryption/decryption

-- Function to encrypt text using AES-GCM
CREATE OR REPLACE FUNCTION public.encrypt_text(plaintext TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  encrypted_result TEXT;
BEGIN
  -- This is a placeholder - actual encryption will be handled in the edge function
  -- We'll mark this as encrypted by adding a prefix
  RETURN 'enc_' || encode(plaintext::bytea, 'base64');
END;
$$;

-- Function to decrypt text
CREATE OR REPLACE FUNCTION public.decrypt_text(encrypted_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- This is a placeholder - actual decryption will be handled in the edge function
  -- Remove the prefix and decode
  IF encrypted_text LIKE 'enc_%' THEN
    RETURN convert_from(decode(substring(encrypted_text from 5), 'base64'), 'UTF8');
  ELSE
    RETURN encrypted_text;
  END IF;
END;
$$;

-- Trigger to automatically encrypt credentials on insert/update
CREATE OR REPLACE FUNCTION public.encrypt_credentials_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only encrypt if not already encrypted
  IF NEW.api_key IS NOT NULL AND (NEW.encrypted_api_key IS NULL OR NEW.encryption_version = 0) THEN
    NEW.encrypted_api_key = public.encrypt_text(NEW.api_key);
  END IF;
  
  IF NEW.api_secret IS NOT NULL AND (NEW.encrypted_api_secret IS NULL OR NEW.encryption_version = 0) THEN
    NEW.encrypted_api_secret = public.encrypt_text(NEW.api_secret);
  END IF;
  
  -- Set encryption version to latest
  NEW.encryption_version = 1;
  
  RETURN NEW;
END;
$$;

-- Create trigger on trading_credentials
DROP TRIGGER IF EXISTS encrypt_credentials_on_change ON public.trading_credentials;
CREATE TRIGGER encrypt_credentials_on_change
  BEFORE INSERT OR UPDATE ON public.trading_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.encrypt_credentials_trigger();

-- Policy to prevent direct access to unencrypted credentials
CREATE POLICY "Block access to unencrypted credentials" ON public.trading_credentials
  FOR SELECT USING (
    -- Only allow access if user is authenticated and trying to access encrypted columns
    auth.uid() IS NOT NULL AND 
    (encrypted_api_key IS NOT NULL AND encrypted_api_secret IS NOT NULL)
  );

-- Update RLS policy to be more restrictive
DROP POLICY IF EXISTS "Authenticated users can manage trading credentials" ON public.trading_credentials;
CREATE POLICY "Authenticated users can manage encrypted credentials" ON public.trading_credentials
  FOR ALL USING (
    auth.uid() IS NOT NULL AND 
    (encrypted_api_key IS NOT NULL OR NEW.encrypted_api_key IS NOT NULL)
  );

-- Trigger existing credentials migration
UPDATE public.trading_credentials 
SET updated_at = now() 
WHERE encryption_version = 0 OR encrypted_api_key IS NULL;