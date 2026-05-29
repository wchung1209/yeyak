-- =====================================================================
-- Public access-request flow.
--
-- Before: invite-only system required the admin to manually issue an
--   invites row (SQL or POST /api/invite) to bring a user in. There
--   was no in-app path for prospective users to ask for access.
--
-- After: anonymous visitors POST to /api/access-requests to register
--   intent. Admin reviews from /admin/access-requests, approves
--   (which auto-creates an invites row + returns the shareable URL)
--   or rejects.
--
-- access_requests is the request inbox. The actual invite still flows
-- through public.invites — we just link the two via invite_id.
--
-- Also extends activity_log.event_type to cover the new events.
-- =====================================================================

create table if not exists public.access_requests (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  first_name    text not null,
  last_name     text not null,
  display_name  text,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  -- Links to the invite row created on approval. Null for pending or
  -- rejected requests.
  invite_id     uuid references public.invites(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Admin list view is "show me the pending ones first, newest first".
create index if not exists access_requests_status_created_idx
  on public.access_requests (status, created_at desc);

-- Case-insensitive lookup by email for dedupe checks.
create index if not exists access_requests_email_lower_idx
  on public.access_requests (lower(email));

alter table public.access_requests enable row level security;

-- Anyone (anon + authenticated) can submit a request. The API layer
-- still gates duplicates and rate-limits in code.
drop policy if exists "Anyone can submit access request" on public.access_requests;
create policy "Anyone can submit access request"
  on public.access_requests for insert
  to anon, authenticated
  with check (true);

-- Only admins can read, update, or delete.
drop policy if exists "Admin manages access requests" on public.access_requests;
create policy "Admin manages access requests"
  on public.access_requests for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ─────────────────────────────────────────────────────────────────
-- Extend activity_log event vocabulary.
-- ─────────────────────────────────────────────────────────────────
alter table public.activity_log
  drop constraint if exists activity_log_event_type_check;

alter table public.activity_log
  add constraint activity_log_event_type_check
  check (event_type in (
    'search', 'task_created', 'task_cancelled',
    'booking_confirmed', 'booking_cancelled',
    'sniper_poll', 'sniper_booked',
    'login', 'invite_sent',
    -- New events for the access-request flow.
    'access_requested', 'access_approved', 'access_rejected'
  ));
