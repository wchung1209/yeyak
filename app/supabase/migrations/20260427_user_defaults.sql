-- =====================================================================
-- User defaults on profiles.
--
-- Lets the agent stop interrogating returning users for city / party
-- size / neighborhood / dinner window every conversation. All fields
-- are nullable: null means "no default — ask the user if it matters".
--
-- Timezone is included as a column now (used by the date-anchor in the
-- agent system prompt) but is not yet exposed in the Settings UI; we
-- default everyone to America/New_York for the NYC-only beta.
-- =====================================================================

alter table public.profiles
  add column if not exists default_city text,
  add column if not exists default_party_size int
    check (default_party_size is null or default_party_size between 1 and 20),
  add column if not exists default_neighborhood text,
  add column if not exists default_time_start time,
  add column if not exists default_time_end time,
  add column if not exists timezone text not null default 'America/New_York';
