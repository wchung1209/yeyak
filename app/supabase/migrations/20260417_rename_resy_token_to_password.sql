-- Rename profiles.resy_token → profiles.resy_password_encrypted.
--
-- Why: the Apify MCP server doesn't issue a reusable session token. Each
-- new MCP connection must call `login` with email + password again. So
-- the column we keep is the user's Resy password (encrypted), not a
-- session token.
--
-- This migration only renames the column. Task #18 will switch the
-- read/write path to Supabase Vault for actual encryption-at-rest.
-- Today the value is stored as plaintext under this column name.
--
-- Apply via Supabase Studio SQL editor or `supabase db push`.

alter table public.profiles
  rename column resy_token to resy_password_encrypted;
