-- =====================================================================
-- Date-range monitoring + one-active-monitor-per-venue constraint.
--
-- Before: each reservation_task watched a single (target_date,
--   time_start..time_end) slice. Wide ranges required multiple tasks.
-- After: a task carries target_date as the start of the range and
--   target_date_end as the (inclusive) end. The worker iterates the
--   range each cron tick and books the first slot that matches.
--   target_date_end IS NULL means single-day (backward-compat with
--   pre-existing rows).
--
-- Plus a partial unique index that allows at most one ACTIVE monitor
-- per (user_id, venue_id) — prevents the user from accidentally
-- ending up with two parallel watches that both auto-book.
-- =====================================================================

alter table public.reservation_tasks
  add column if not exists target_date_end date;

-- For range tasks the end must be on or after the start; null is OK.
alter table public.reservation_tasks
  drop constraint if exists reservation_tasks_date_range_check;
alter table public.reservation_tasks
  add constraint reservation_tasks_date_range_check
  check (target_date_end is null or target_date_end >= target_date);

-- One active monitor per (user, restaurant). Cancelled / booked /
-- expired tasks don't count toward the limit so the user can
-- continue creating new monitors after one resolves.
drop index if exists reservation_tasks_one_active_per_venue;
create unique index reservation_tasks_one_active_per_venue
  on public.reservation_tasks (user_id, venue_id)
  where status = 'active';
