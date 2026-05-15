-- =====================================================================
-- Tool-call audit log for the Resy MCP client.
--
-- Every call we make to the actor (search, check_availability, book,
-- login, my_reservations, cancel) writes one row here so we can debug
-- what the agent and sniper are actually sending and getting back.
--
-- Distinct from cost_events: cost_events tracks billable calls for
-- invoice reconciliation (search/check/book only). tool_call_log
-- captures every call for behavioral debugging.
-- =====================================================================

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

-- Hot-path query: "show me the last N calls for this user/session".
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
-- No INSERT/UPDATE/DELETE policies: only service-role writes.
