-- =====================================================================
-- Move Resy password from plaintext column to Supabase Vault.
--
-- Before: profiles.resy_password_encrypted (text, plaintext)
-- After:  profiles.resy_password_secret_id (uuid → vault.secrets.id)
--
-- Reads happen via public.get_resy_password(uuid), service-role only.
-- Writes happen via public.set_resy_password(text), authenticated.
--
-- Idempotent: safe to re-run. Uses `if exists` guards everywhere.
-- =====================================================================

-- 1. Add the new secret-id column. ----------------------------------
alter table public.profiles
  add column if not exists resy_password_secret_id uuid;

-- 2. Writer RPC ------------------------------------------------------
-- Authenticated callers replace their own password. An empty/NULL value
-- clears the credential. We delete the prior secret on replace so we
-- don't accumulate orphans in vault.secrets.
create or replace function public.set_resy_password(new_password text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  uid uuid := auth.uid();
  existing_id uuid;
  new_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select resy_password_secret_id
    into existing_id
    from public.profiles
   where id = uid;

  if existing_id is not null then
    delete from vault.secrets where id = existing_id;
  end if;

  if new_password is null or length(new_password) = 0 then
    update public.profiles
       set resy_password_secret_id = null
     where id = uid;
    return;
  end if;

  -- Vault names must be unique; scope per-user.
  select vault.create_secret(
           new_password,
           'resy_password_' || uid::text,
           'Resy login password'
         )
    into new_id;

  update public.profiles
     set resy_password_secret_id = new_id
   where id = uid;
end;
$$;

revoke execute on function public.set_resy_password(text) from public, anon;
grant execute on function public.set_resy_password(text) to authenticated;

-- 3. Reader RPC ------------------------------------------------------
-- Service role only. Returns the plaintext password for the requested
-- user, or NULL if none is set. Wrapped in a SECURITY DEFINER function
-- because vault.decrypted_secrets isn't exposed via PostgREST directly.
create or replace function public.get_resy_password(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  sid uuid;
  pw text;
begin
  select resy_password_secret_id
    into sid
    from public.profiles
   where id = p_user_id;

  if sid is null then
    return null;
  end if;

  select decrypted_secret
    into pw
    from vault.decrypted_secrets
   where id = sid;

  return pw;
end;
$$;

revoke execute on function public.get_resy_password(uuid) from public, anon, authenticated;
grant execute on function public.get_resy_password(uuid) to service_role;

-- 4. One-time data migration ----------------------------------------
-- Encrypt any existing plaintext into vault and drop the old column.
-- Wrapped in a DO block so a clean install (no rows, no column) skips
-- gracefully.
do $$
declare
  r record;
  new_id uuid;
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'resy_password_encrypted'
  ) then
    for r in
      execute 'select id, resy_password_encrypted from public.profiles
                where resy_password_encrypted is not null
                  and length(resy_password_encrypted) > 0
                  and resy_password_secret_id is null'
    loop
      select vault.create_secret(
               r.resy_password_encrypted,
               'resy_password_' || r.id::text,
               'Resy login password (migrated from plaintext)'
             )
        into new_id;
      update public.profiles
         set resy_password_secret_id = new_id
       where id = r.id;
    end loop;

    alter table public.profiles drop column resy_password_encrypted;
  end if;
end$$;
