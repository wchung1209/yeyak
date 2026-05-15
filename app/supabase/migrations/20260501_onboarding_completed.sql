-- =====================================================================
-- Onboarding completion flag.
--
-- A new user is shown /onboarding on first login. Both "Connect &
-- continue" and "Skip for now" set onboarding_completed = true so the
-- user is not nagged on subsequent visits.
--
-- Default false → all existing users with no value see onboarding once;
-- their account already has Resy credentials set so they can just skip.
-- We could backfill = true for users who already have credentials, but
-- the one-time prompt is a feature, not a bug.
-- =====================================================================

alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

-- Backfill: anyone who has already configured Resy credentials in the
-- old Settings flow has effectively completed onboarding — no need to
-- nag them on next login.
update public.profiles
   set onboarding_completed = true
 where onboarding_completed = false
   and resy_email is not null
   and resy_password_secret_id is not null;
