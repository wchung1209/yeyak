-- =====================================================================
-- Settings refinements:
--   * Drop default_neighborhood (we don't use it after re-scoping).
--   * Rename default_time_{start,end} → default_dinner_{start,end} so the
--     column intent is unambiguous now that we also track lunch.
--   * Add default_lunch_{start,end}.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

alter table public.profiles
  drop column if exists default_neighborhood;

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'default_time_start'
  ) then
    alter table public.profiles
      rename column default_time_start to default_dinner_start;
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'default_time_end'
  ) then
    alter table public.profiles
      rename column default_time_end to default_dinner_end;
  end if;
end$$;

alter table public.profiles
  add column if not exists default_lunch_start time,
  add column if not exists default_lunch_end   time;
