-- =====================================================================
-- Yeyak — test-user lifecycle helpers
--
-- Run these snippets ONE AT A TIME in the Supabase SQL editor (which
-- runs as service_role and can touch the auth schema). They are not
-- migrations — don't put them in /migrations.
--
-- WARNING: section 3 deletes a real user. There is no undo.
-- =====================================================================


-- ─── 1. Create a test user ───────────────────────────────────────────
-- Edit the two literal values, then run this whole block.
-- The password is bcrypt-hashed via pgcrypto; a row is created in both
-- auth.users (the credential) and auth.identities (the email-provider
-- linkage so Supabase can resolve the login). Yeyak's existing
-- handle_new_user trigger then auto-creates the matching public.profiles
-- row, which means the user can immediately sign in via the /login page.
-- =====================================================================

with new_user as (
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,        -- skip confirmation; treat email as verified
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'test1@example.com',                              -- ← edit
    crypt('TempPassword123!', gen_salt('bf')),        -- ← edit
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
  returning id, email
)
insert into auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  new_user.id,
  jsonb_build_object('sub', new_user.id::text, 'email', new_user.email),
  'email',
  new_user.email,
  now(),
  now(),
  now()
from new_user;


-- ─── 2. Update a user's password ─────────────────────────────────────
-- Use this when you've forgotten the test password or want to rotate
-- credentials without nuking the rest of the row.
-- =====================================================================

update auth.users
   set encrypted_password = crypt('NewPassword456!', gen_salt('bf')),  -- ← edit
       updated_at         = now()
 where email = 'test1@example.com';                                    -- ← edit


-- ─── 3. Delete a user and all their data ─────────────────────────────
-- Cascades through public.profiles → reservation_tasks → reservations
-- (all FK with `on delete cascade`). Vault secrets owned by the user
-- aren't FK'd into auth.users, so we explicitly drop them first to
-- avoid orphans.
--
-- Set the email once at the top; the rest references it.
-- =====================================================================

with target as (
  select u.id as user_id, p.resy_password_secret_id as secret_id
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.email = 'test1@example.com'                                 -- ← edit
)
delete from vault.secrets
 where id in (select secret_id from target where secret_id is not null);

delete from auth.users where email = 'test1@example.com';              -- ← match above
