-- =====================================================================
-- Yeyak — initial database schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) once.
-- =====================================================================

-- Extensions --------------------------------------------------------
create extension if not exists pgcrypto;
-- Supabase Vault ships enabled on new projects; `vault` schema should
-- already exist. No-op if it does.

-- ─────────────────────────────────────────────────────────────────
-- PROFILES  (extends auth.users)
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  role          text not null default 'user' check (role in ('admin', 'user')),
  resy_email    text,
  -- Reference into vault.secrets. Read via public.get_resy_password(uuid)
  -- (service role); write via public.set_resy_password(text)
  -- (authenticated). The plaintext never leaves Postgres in either path.
  resy_password_secret_id uuid,
  notify_email  boolean not null default true,
  notify_sms    boolean not null default false,
  phone         text,
  -- User defaults — injected into the agent system prompt so the LLM
  -- stops asking returning users for these every conversation. All
  -- nullable: null means "no default, ask if it matters".
  default_city          text,
  default_party_size    int check (default_party_size is null or default_party_size between 1 and 10),
  default_dinner_start  time,
  default_dinner_end    time,
  default_lunch_start   time,
  default_lunch_end     time,
  timezone              text not null default 'America/New_York',
  -- True once the user has either connected Resy or explicitly skipped
  -- the /onboarding flow. Suppresses the one-time prompt on later logins.
  onboarding_completed  boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ─────────────────────────────────────────────────────────────────
-- is_admin() — SECURITY DEFINER helper to avoid RLS recursion when
-- a policy needs to check the caller's role against public.profiles.
-- Without this, an "admin can read profiles" policy that does a
-- `select from profiles` triggers itself → infinite recursion error.
-- Defined AFTER public.profiles exists so SQL-language function body
-- validation succeeds.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.is_admin(user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = user_id and role = 'admin'
  );
$$;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "Admin can read all profiles" on public.profiles;
create policy "Admin can read all profiles"
  on public.profiles for select
  using (public.is_admin());

-- ─────────────────────────────────────────────────────────────────
-- Resy password — Vault-backed accessors.
-- Plaintext password never leaves Postgres. The client writes via
-- set_resy_password() (authenticated) and the server reads via
-- get_resy_password() (service role only).
-- ─────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────
-- INVITES
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  invited_by  uuid references public.profiles(id),
  token       text not null unique default encode(gen_random_bytes(32), 'hex'),
  accepted    boolean not null default false,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days')
);

alter table public.invites enable row level security;

drop policy if exists "Admin manages invites" on public.invites;
create policy "Admin manages invites"
  on public.invites for all
  using (public.is_admin());

-- ─────────────────────────────────────────────────────────────────
-- RESERVATION TASKS (active sniper jobs)
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.reservation_tasks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  venue_id        text not null,
  restaurant_name text not null,
  restaurant_url  text,
  target_date     date not null,
  time_start      time not null,
  time_end        time not null,
  party_size      int  not null check (party_size > 0),
  status          text not null default 'active'
                    check (status in ('active', 'booked', 'cancelled', 'expired')),
  notify_only     boolean not null default false,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  last_checked_at timestamptz
);

create index if not exists reservation_tasks_active_idx
  on public.reservation_tasks (status, target_date)
  where status = 'active';

alter table public.reservation_tasks enable row level security;

drop policy if exists "Users can manage own tasks" on public.reservation_tasks;
create policy "Users can manage own tasks"
  on public.reservation_tasks for all
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- RESERVATIONS (confirmed bookings)
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.reservations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  task_id         uuid references public.reservation_tasks(id) on delete set null,
  platform        text not null default 'resy',
  platform_id     text,
  restaurant_name text not null,
  venue_id        text,
  date            date not null,
  time            time not null,
  party_size      int  not null,
  status          text not null default 'confirmed'
                    check (status in ('confirmed', 'cancelled')),
  booked_by       text not null default 'agent'
                    check (booked_by in ('agent', 'sniper', 'manual')),
  booked_at       timestamptz not null default now(),
  raw_data        jsonb
);

alter table public.reservations enable row level security;

drop policy if exists "Users can manage own reservations" on public.reservations;
create policy "Users can manage own reservations"
  on public.reservations for all
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- COST EVENTS (billable Apify calls — admin/worker only)
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.cost_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.profiles(id) on delete set null,
  action          text not null check (action in ('search', 'check_availability', 'book')),
  cost_usd        numeric(8,4) not null,
  venue_id        text,
  restaurant_name text,
  session_id      text,
  source          text not null default 'agent' check (source in ('agent', 'sniper')),
  failed          boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists cost_events_created_at_idx
  on public.cost_events (created_at desc);

alter table public.cost_events enable row level security;

-- Only admins can read (worker uses service-role key which bypasses RLS)
drop policy if exists "Admin can read all cost_events" on public.cost_events;
create policy "Admin can read all cost_events"
  on public.cost_events for select
  using (public.is_admin());

-- ─────────────────────────────────────────────────────────────────
-- ACTIVITY LOG (admin-only)
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  event_type  text not null check (event_type in (
    'search', 'task_created', 'task_cancelled',
    'booking_confirmed', 'booking_cancelled',
    'sniper_poll', 'sniper_booked',
    'login', 'invite_sent'
  )),
  description text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists activity_log_created_at_idx
  on public.activity_log (created_at desc);

alter table public.activity_log enable row level security;

drop policy if exists "Admin reads activity" on public.activity_log;
create policy "Admin reads activity"
  on public.activity_log for select
  using (public.is_admin());

-- ─────────────────────────────────────────────────────────────────
-- TOOL CALL LOG (every Resy MCP call, for debugging)
-- Distinct from cost_events: cost_events tracks billable calls only
-- (search/check_availability/book) for invoice reconciliation. This
-- table captures ALL six tools — including login/cancel/my_reservations
-- — with full args + result payloads so we can see exactly what the
-- agent and sniper sent and got back.
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.tool_call_log (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid references public.profiles(id) on delete set null,
  source        text not null check (source in ('agent', 'sniper')),
  session_id    text,
  tool_name     text not null,
  args          jsonb,
  result        jsonb,
  error_kind    text,
  error_message text,
  duration_ms   int
);

create index if not exists tool_call_log_user_created_idx
  on public.tool_call_log (user_id, created_at desc);

create index if not exists tool_call_log_session_created_idx
  on public.tool_call_log (session_id, created_at desc);

alter table public.tool_call_log enable row level security;

drop policy if exists "Users can read own tool calls" on public.tool_call_log;
create policy "Users can read own tool calls"
  on public.tool_call_log for select
  using (auth.uid() = user_id);

drop policy if exists "Admin can read all tool calls" on public.tool_call_log;
create policy "Admin can read all tool calls"
  on public.tool_call_log for select
  using (public.is_admin());

-- ─────────────────────────────────────────────────────────────────
-- TRIGGER: auto-create profile on user signup
-- ─────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', null));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
