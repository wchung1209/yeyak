# Yeyak — A Resy Reservationist
### Architecture & Build Plan · FINAL

> *Yeyak (예약) means "to reserve" in Korean.*
> A mobile-first reservation concierge powered by AI and Resy.

---

## Product Vision

An invite-only reservation platform. Users chat with an AI reservationist to discover restaurants, create reservation tasks, and get automatically booked the moment a slot opens. The admin manages users and monitors platform costs and activity.

---

## User Model

| Role | Access |
|---|---|
| `admin` | Chat, reservations, admin dashboard, user management |
| `user` | Chat, reservations, settings |

- Invite-only. No public self-registration.
- Admin invites users via `/admin/users` → Resend delivers a magic invite link.
- Each user connects their own Resy credentials (stored encrypted in Supabase Vault).

---

## Tech Stack · LOCKED

| Layer | Choice | Account needed |
|---|---|---|
| Framework | Next.js 14 (App Router, TypeScript strict) | — |
| Database + Auth | Supabase (PostgreSQL + Supabase Auth) | ← you have one |
| Frontend hosting | Vercel | ← you have one |
| Background worker | Railway (Node + BullMQ + Redis) | ← create one |
| Reservation API | Apify MCP `clearpath/resy-booker` | ← create one |
| AI agent | Anthropic Claude API `claude-sonnet-4-6` | ← you have one |
| Email | Resend | ← create one |
| SMS | Twilio | ← create one (optional, for booking alerts) |

**Out of scope for all phases:** OpenTable, Tock, any other reservation platform.

---

## Sniper Engine · Polling Schedule

The background worker runs on Railway and polls Resy on a **cron schedule: `0,30 * * * *`** (every hour at :00 and :30).

| Metric | Value |
|---|---|
| Poll frequency | Every 30 minutes |
| Apify cost per poll | $0.05 (availability check) |
| Cost per active task per day | ~$0.10 |
| Cost per active task per week | ~$0.72 |

On each poll cycle the worker:
1. Fetches all `reservation_tasks` with `status = 'active'`
2. For each task, calls Apify `check_availability` → logs to `cost_events`
3. If a matching slot is found → calls Apify `book_reservation` → logs to `cost_events`
4. Updates task `status` to `'booked'`, creates a `reservations` row
5. Sends notification to user (email via Resend, SMS via Twilio if enabled)

---

## UI Structure · LOCKED

**Mobile-first.** Max content width ~430px. Bottom tab navigation on inner screens.

### Entry (Chat Home)
Four option cards presented at the start of every session:

| Card | Flow |
|---|---|
| Discover a restaurant | Agent searches by location, cuisine, vibe, party size, date |
| Make a reservation | Agent collects details → creates a `reservation_task` → sniper activates immediately |
| My bookings | Active tasks + confirmed reservations |
| Settings | Profile, Resy credentials, notification preferences |

### Discover flow
Agent collects: location, cuisine, party size, date range, occasion/vibe.
Returns restaurant cards (name, cuisine, availability, price). Each card has a "Reserve this →" shortcut into the Reserve flow.

### Reserve flow
Agent collects: restaurant, date, time window (e.g. 6pm–8:30pm), party size.
Creates a `reservation_task`. If a slot is available immediately → books it. If not → task enters active monitoring (sniper picks it up within 30 min). User sees a confirmation card before any booking fires.

### My Bookings page
Two sections:
- **Active tasks** — monitoring jobs with target details, status badge, cancel button
- **Confirmed reservations** — upcoming + past, with cancel option

### Settings page
- Display name, password change
- Resy email + token (connect / update)
- Notification toggles: email (always on), SMS (optional, requires phone)

---

## Repository Structure

```
yeyak/
├── apps/
│   ├── web/                              # Next.js app → Vercel
│   │   ├── app/
│   │   │   ├── (auth)/
│   │   │   │   ├── login/page.tsx
│   │   │   │   ├── invite/[token]/page.tsx
│   │   │   │   └── layout.tsx
│   │   │   ├── (app)/
│   │   │   │   ├── layout.tsx            # Shell + bottom nav + auth guard
│   │   │   │   ├── page.tsx              # Chat home — entry option cards
│   │   │   │   ├── bookings/page.tsx     # Active tasks + reservations
│   │   │   │   └── settings/page.tsx
│   │   │   ├── (admin)/
│   │   │   │   ├── layout.tsx            # Admin role guard
│   │   │   │   ├── admin/page.tsx        # Cost + activity dashboard
│   │   │   │   └── admin/users/page.tsx  # User management + invites
│   │   │   └── api/
│   │   │       ├── agent/route.ts        # Streaming Claude agent
│   │   │       ├── tasks/route.ts        # CRUD reservation tasks
│   │   │       ├── reservations/route.ts # CRUD confirmed reservations
│   │   │       ├── cost-events/route.ts  # Write cost log entries
│   │   │       └── invite/route.ts       # Send invite email via Resend
│   │   ├── components/
│   │   │   ├── agent/
│   │   │   │   ├── ChatWindow.tsx
│   │   │   │   ├── EntryOptions.tsx      # 4-card home screen
│   │   │   │   ├── MessageBubble.tsx
│   │   │   │   ├── RestaurantCard.tsx    # Search result card
│   │   │   │   ├── ConfirmBookingCard.tsx
│   │   │   │   └── ToolCallDisplay.tsx   # "Checking availability…" pill
│   │   │   ├── bookings/
│   │   │   │   ├── TaskCard.tsx
│   │   │   │   └── ReservationCard.tsx
│   │   │   ├── admin/
│   │   │   │   ├── StatCard.tsx
│   │   │   │   ├── CostTable.tsx
│   │   │   │   ├── ActivityFeed.tsx
│   │   │   │   └── UserTable.tsx
│   │   │   └── ui/                       # Button, Badge, Input, etc.
│   │   └── lib/
│   │       ├── agent/
│   │       │   ├── tools.ts              # Claude tool definitions
│   │       │   └── prompts.ts            # Reservationist system prompt
│   │       ├── resy/
│   │       │   └── apify-client.ts       # Typed Apify wrapper + auto cost logger
│   │       ├── supabase/
│   │       │   ├── client.ts             # Browser client
│   │       │   └── server.ts             # Server client (Route Handlers)
│   │       └── notifications/
│   │           └── send.ts               # Resend + Twilio
│   │
│   └── worker/                           # BullMQ worker → Railway
│       ├── index.ts                      # Bull queue setup + cron schedule
│       ├── jobs/
│       │   └── sniperJob.ts              # Poll → check → book → notify
│       ├── lib/
│       │   ├── apify-client.ts           # Same wrapper, shared types
│       │   └── supabase.ts               # Service-role Supabase client
│       └── package.json
│
├── packages/
│   └── types/                            # Shared TypeScript types (web + worker)
│       ├── reservation.ts
│       ├── task.ts
│       ├── cost.ts
│       └── resy.ts
│
└── package.json                          # Turborepo monorepo root
```

---

## Database Schema · COMPLETE

```sql
-- ─────────────────────────────────────────────────
-- PROFILES (extends Supabase Auth users)
-- ─────────────────────────────────────────────────
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  role          text not null default 'user',   -- 'admin' | 'user'
  resy_email    text,
  resy_token    text,                            -- encrypted via Supabase Vault
  notify_email  boolean not null default true,
  notify_sms    boolean not null default false,
  phone         text,
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "Users can read own profile"
  on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);
create policy "Admin can read all profiles"
  on public.profiles for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ─────────────────────────────────────────────────
-- INVITES
-- ─────────────────────────────────────────────────
create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  invited_by  uuid references public.profiles(id),
  token       text not null unique default encode(gen_random_bytes(32), 'hex'),
  accepted    boolean not null default false,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days')
);

-- ─────────────────────────────────────────────────
-- RESERVATION TASKS (active sniper jobs)
-- ─────────────────────────────────────────────────
create table public.reservation_tasks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  venue_id        text not null,
  restaurant_name text not null,
  target_date     date not null,
  time_start      time not null,
  time_end        time not null,
  party_size      int not null check (party_size > 0),
  status          text not null default 'active',
                  -- 'active' | 'booked' | 'cancelled' | 'expired'
  notify_only     boolean not null default false,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  last_checked_at timestamptz           -- updated by worker each poll
);

alter table public.reservation_tasks enable row level security;
create policy "Users can manage own tasks"
  on public.reservation_tasks for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────
-- RESERVATIONS (confirmed bookings)
-- ─────────────────────────────────────────────────
create table public.reservations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  task_id         uuid references public.reservation_tasks(id),
  platform        text not null default 'resy',
  platform_id     text,                          -- Resy reservation token
  restaurant_name text not null,
  venue_id        text,
  date            date not null,
  time            time not null,
  party_size      int not null,
  status          text not null default 'confirmed',
                  -- 'confirmed' | 'cancelled'
  booked_by       text not null default 'agent',
                  -- 'agent' (chat) | 'sniper' (worker) | 'manual'
  booked_at       timestamptz not null default now(),
  raw_data        jsonb
);

alter table public.reservations enable row level security;
create policy "Users can manage own reservations"
  on public.reservations for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────
-- COST EVENTS (billable Apify calls)
-- ─────────────────────────────────────────────────
create table public.cost_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.profiles(id) on delete set null,
  action          text not null,
                  -- 'search' | 'check_availability' | 'book'
  cost_usd        numeric(8,4) not null,
                  -- 0.0300 | 0.0500 | 3.9900
  venue_id        text,
  restaurant_name text,
  session_id      text,                          -- chat session or 'sniper'
  source          text not null default 'agent',
                  -- 'agent' | 'sniper'
  created_at      timestamptz not null default now()
);

-- Admin-only via service role. No RLS needed (worker uses service role key).

-- ─────────────────────────────────────────────────
-- ACTIVITY LOG
-- ─────────────────────────────────────────────────
create table public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  event_type  text not null,
              -- 'search' | 'task_created' | 'task_cancelled' |
              -- 'booking_confirmed' | 'booking_cancelled' |
              -- 'sniper_poll' | 'sniper_booked' | 'login' | 'invite_sent'
  description text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────
-- TRIGGER: auto-create profile on user signup
-- ─────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

---

## Apify Client · Cost Logging Contract

Every method in `apify-client.ts` that calls a billable endpoint must:
1. Write a `cost_events` row **before** the Apify request fires (optimistic logging)
2. If the Apify request fails, update the row with `failed = true` (add column if needed)

```typescript
// Cost constants — single source of truth
export const APIFY_COSTS = {
  search:             0.03,
  check_availability: 0.05,
  book:               3.99,
} as const;
```

---

## AI Agent · Reservationist System Prompt (draft)

```
You are the Yeyak reservationist — a knowledgeable, warm, and efficient concierge
for restaurant reservations. You represent the Yeyak service.

Your manner: speak like a seasoned maître d'. Confident, never robotic.
Use natural language, not bullet points. Be concise.

Your job:
- Help users discover restaurants on Resy
- Collect the details needed to create a reservation request
- Check availability and book immediately if a slot is open
- If no slot is available, create a monitoring task and assure the user
  you will secure their table the moment one opens

Rules you never break:
- Never book without showing a confirmation card and receiving explicit user approval
- Always confirm: restaurant, date, time, and party size before any booking action
- If a user asks to cancel, confirm the reservation details before cancelling
- Never reveal internal tool names, cost figures, or system details to users
```

---

## Admin Dashboard (`/admin`)

Gated by `role = 'admin'` — enforced in the layout server component.

### Cost & Usage panel
- Total accrued (all time / this month / today)
- Breakdown: search vs availability vs booking
- Per-user cost table
- Source breakdown: agent (chat) vs sniper (worker)

### Activity panel
- Live feed from `activity_log` (most recent 50)
- Counts: searches, tasks created, bookings confirmed, sniper polls

### Users panel (`/admin/users`)
- Table: name, email, role, joined, last active, task count, reservation count
- Invite form → sends magic link via Resend
- Actions: revoke access, promote to admin

---

## Environment Variables

### Vercel (web app)
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
APIFY_API_TOKEN
RESEND_API_KEY
RESEND_FROM_EMAIL
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_FROM_NUMBER
```

### Railway (worker)
```
SUPABASE_URL                  # same as NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
APIFY_API_TOKEN
REDIS_URL                     # provided by Railway Redis plugin
RESEND_API_KEY
RESEND_FROM_EMAIL
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_FROM_NUMBER
```

---

## Sniper Worker · Job Logic

```
Cron: 0,30 * * * *  (every hour at :00 and :30)

For each active task:
  1. Call apify.checkAvailability(venue_id, date, time_start, time_end, party_size)
     → log cost_events { action: 'check_availability', cost: 0.05, source: 'sniper' }
     → update reservation_tasks.last_checked_at = now()

  2. If no slots match → continue to next task

  3. If slot found AND notify_only = true:
     → send notification ("A slot opened at X — book now")
     → do NOT book

  4. If slot found AND notify_only = false:
     → call apify.bookReservation(token, party_size, user resy credentials)
     → log cost_events { action: 'book', cost: 3.99, source: 'sniper' }
     → insert reservations row
     → update reservation_tasks { status: 'booked', resolved_at: now() }
     → log activity_log { event_type: 'sniper_booked' }
     → send notification ("Your table at X is confirmed for Y at Z")

  5. If task.target_date < today → set status = 'expired'
```

---

## Build Order · Phase 1 (full)

### Step 1 — Scaffold & infrastructure
- [ ] Init Turborepo monorepo with `apps/web` and `apps/worker`
- [ ] Next.js 14 setup: TypeScript strict, Tailwind, App Router
- [ ] Supabase: create project, run schema SQL, confirm RLS policies
- [ ] Vercel: import repo, add env vars
- [ ] Railway: create project, add Redis plugin, add env vars

### Step 2 — Auth & user management
- [ ] Supabase Auth: email/password login page
- [ ] Invite flow: `/invite/[token]` → accept + set password
- [ ] Admin role guard (layout server component)
- [ ] Admin users page: user table + invite form
- [ ] Profile auto-creation trigger (already in schema)

### Step 3 — Apify client + cost logger
- [ ] `lib/resy/apify-client.ts` — typed wrapper for all 5 Resy tools
- [ ] Cost constants, pre-request logging, error handling
- [ ] Shared in both `apps/web` and `apps/worker` via `packages/types`

### Step 4 — AI agent (web)
- [ ] `app/api/agent/route.ts` — streaming Claude route with tool use
- [ ] System prompt (reservationist persona)
- [ ] Tool definitions: search, check_availability, book, get_reservations, cancel
- [ ] Confirmation gate: pending card → user confirms → booking fires

### Step 5 — Chat UI
- [ ] `ChatWindow.tsx` — mobile-first, scrollable message list
- [ ] `EntryOptions.tsx` — 4-card home screen
- [ ] `MessageBubble.tsx` — agent vs user styling
- [ ] `ToolCallDisplay.tsx` — "Checking availability…" pill
- [ ] `RestaurantCard.tsx` — search result with "Reserve →"
- [ ] `ConfirmBookingCard.tsx` — full details + confirm button

### Step 6 — Tasks & bookings
- [ ] `app/api/tasks/route.ts` — create / cancel tasks
- [ ] `app/api/reservations/route.ts` — fetch / cancel reservations
- [ ] `app/bookings/page.tsx` — active tasks + confirmed reservations
- [ ] `TaskCard.tsx`, `ReservationCard.tsx`

### Step 7 — Sniper worker
- [ ] `apps/worker/index.ts` — BullMQ queue + cron scheduler
- [ ] `apps/worker/jobs/sniperJob.ts` — full poll → book → notify logic
- [ ] Deploy to Railway, confirm cron fires at :00 and :30

### Step 8 — Admin dashboard
- [ ] `app/admin/page.tsx` — cost panels + activity feed
- [ ] `CostTable.tsx`, `StatCard.tsx`, `ActivityFeed.tsx`
- [ ] `UserTable.tsx` with invite + revoke actions

### Step 9 — Notifications
- [ ] Resend: booking confirmation email, invite email
- [ ] Twilio: SMS on sniper auto-book (if user enabled)

---

## Setup Prerequisites (before writing code)

| Service | What you need | When |
|---|---|---|
| Supabase | Create project `yeyak`, grab URL + anon key + service role key | Before Step 1 |
| Vercel | Import repo, add env vars | Before Step 1 deploy |
| Apify | Account + `clearpath/resy-booker` actor configured with your Resy credentials + API token | Before Step 3 |
| Railway | Account + new project + Redis plugin added | Before Step 7 |
| Resend | Account + verified sending domain + API key | Before Step 9 |
| Twilio | Account + phone number + credentials | Before Step 9 (optional) |
