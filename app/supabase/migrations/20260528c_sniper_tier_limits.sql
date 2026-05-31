-- =====================================================================
-- Sniper tier limits.
--
-- Cost driver context: each sniper tick calls check_availability once per
-- date in the monitor's range, at $0.05 a call. A 6-day range × 24 ticks
-- = $7.20/day for one monitor. To control burn we enforce caps per
-- "tier" stored on the profile.
--
-- The tier_limits row is the single source of truth. To loosen the cap
-- for a paid plan, update the row OR change the user's tier — no code
-- change required. Adding a new tier = one INSERT.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────
-- TIER LIMITS (lookup table — one row per tier)
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.tier_limits (
  tier                       text primary key,
  max_active_sniper_tasks    int  not null check (max_active_sniper_tasks >= 0),
  max_sniper_date_range_days int  not null check (max_sniper_date_range_days >= 1),
  created_at                 timestamptz not null default now()
);

-- Defaults. 'paid' is a placeholder for the future paid tier — not used
-- by anyone today but the row exists so promoting a user later is just
-- `update profiles set tier = 'paid'`.
insert into public.tier_limits (tier, max_active_sniper_tasks, max_sniper_date_range_days)
values
  ('free', 2, 1),
  ('paid', 5, 7)
on conflict (tier) do nothing;

-- Anyone authenticated can SELECT to read their own limits in the UI
-- (e.g. "you have 1 of 2 active monitors"). The row contents are
-- intentionally non-secret.
alter table public.tier_limits enable row level security;

drop policy if exists "Anyone reads tier limits" on public.tier_limits;
create policy "Anyone reads tier limits"
  on public.tier_limits for select
  to authenticated, anon
  using (true);

drop policy if exists "Admin manages tier limits" on public.tier_limits;
create policy "Admin manages tier limits"
  on public.tier_limits for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ─────────────────────────────────────────────────────────────────
-- PROFILES.TIER — FK to tier_limits, defaults to 'free'
-- ─────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists tier text not null default 'free'
  references public.tier_limits(tier) on update cascade;

-- ─────────────────────────────────────────────────────────────────
-- ENFORCE TRIGGER on reservation_tasks
--
-- Fires on INSERT and on UPDATE where status transitions to 'active'.
-- (Updates that don't reactivate are fine — cancelling, expiring, or
-- booking out a row never increases the user's load.)
-- ─────────────────────────────────────────────────────────────────
create or replace function public.enforce_sniper_tier_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_tier text;
  limits    public.tier_limits%rowtype;
  active_n  int;
  range_n   int;
  is_activating boolean;
begin
  is_activating := (
    (TG_OP = 'INSERT' and NEW.status = 'active')
    or (TG_OP = 'UPDATE' and OLD.status is distinct from 'active' and NEW.status = 'active')
  );

  if not is_activating then
    return NEW;
  end if;

  select tier into user_tier from public.profiles where id = NEW.user_id;
  if user_tier is null then
    -- Defensive: a profile must exist before a task can target it. Treat
    -- as 'free' to be safe rather than refusing outright.
    user_tier := 'free';
  end if;

  select * into limits from public.tier_limits where tier = user_tier;
  if not found then
    raise exception
      'Tier limits not configured for tier %', user_tier;
  end if;

  -- Active count, excluding the row we're inserting/updating.
  select count(*) into active_n
  from public.reservation_tasks
  where user_id = NEW.user_id
    and status = 'active'
    and id is distinct from NEW.id;

  if active_n >= limits.max_active_sniper_tasks then
    raise exception
      'Active monitor limit reached (% of %). Cancel an existing one or upgrade your tier.',
      active_n, limits.max_active_sniper_tasks
      using errcode = 'check_violation';
  end if;

  -- Date range in days, inclusive. NULL target_date_end means single-day
  -- (range_n = 1).
  range_n := coalesce(NEW.target_date_end, NEW.target_date) - NEW.target_date + 1;

  if range_n > limits.max_sniper_date_range_days then
    raise exception
      'Date range (% days) exceeds your tier limit of % day(s).',
      range_n, limits.max_sniper_date_range_days
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

revoke execute on function public.enforce_sniper_tier_limits() from public;

drop trigger if exists reservation_tasks_enforce_tier_limits on public.reservation_tasks;
create trigger reservation_tasks_enforce_tier_limits
  before insert or update on public.reservation_tasks
  for each row
  execute function public.enforce_sniper_tier_limits();

-- ─────────────────────────────────────────────────────────────────
-- ONE-TIME: cancel existing date-range monitors that now exceed
-- the free-tier 1-day cap. Per the deployment decision, we don't
-- want to grandfather them in — they were the source of the burn.
--
-- A separate cancellation reason in activity_log so the admin /
-- the user can later see why they were stopped.
-- ─────────────────────────────────────────────────────────────────
do $$
declare
  affected_count int;
begin
  with cancelled as (
    update public.reservation_tasks
    set status = 'cancelled'
    where status = 'active'
      and target_date_end is not null
      and target_date_end > target_date
    returning id, user_id
  )
  select count(*) into affected_count from cancelled;

  -- Log the cleanup so we have a trail.
  insert into public.activity_log (user_id, event_type, description, metadata)
  select null, 'task_cancelled',
    'auto-cancelled multi-day monitors when tier limits launched',
    jsonb_build_object('affected_count', affected_count)
  where affected_count > 0;
end$$;
