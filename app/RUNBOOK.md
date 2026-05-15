# Yeyak — First Boot Runbook

Goal: get the web app running locally with Supabase only. The chat route
will error until you add an Anthropic key (expected). The worker won't
start until you add Redis (also expected).

---

## 0 · Prerequisites

```bash
node --version     # need >= 20
corepack --version # ships with Node 20
```

If either is missing: install Node 20 from nodejs.org, then
`corepack enable` (that activates the correct pnpm version).

---

## 1 · Install

```bash
cd path/to/yeyak/app
corepack enable
pnpm install
```

This installs every dep for `apps/web`, `apps/worker`, and the shared
`packages/types` package in one go.

**Expected output:** a long progress bar ending in something like
`Done in 45s`. If it fails, paste the error and I'll help.

---

## 2 · Provision Supabase

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Copy the entire contents of `supabase/schema.sql` and run it.
3. Verify by going to **Table Editor** — you should see six tables:
   `profiles`, `invites`, `reservation_tasks`, `reservations`,
   `cost_events`, `activity_log`.

### Create your admin user

Supabase doesn't let you self-register (that's intentional — Yeyak is
invite-only). Create yourself as the first admin:

1. In Supabase → **Authentication** → **Users** → **Add user** →
   **Create new user**. Enter your email and a password.
2. Copy the new user's **UID**.
3. Back in **SQL Editor**, run:
   ```sql
   update public.profiles set role = 'admin' where id = '<PASTE_UID_HERE>';
   ```

---

## 3 · Environment variables

```bash
cd apps/web
cp .env.example .env.local
```

Edit `apps/web/.env.local`:

```env
# From Supabase → Project Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Placeholders so the env validator doesn't throw
ANTHROPIC_API_KEY=placeholder
APIFY_API_TOKEN=placeholder
RESEND_API_KEY=placeholder
RESEND_FROM_EMAIL=noreply@example.com
APP_URL=http://localhost:3000
```

The placeholder values keep `lib/env.ts` from throwing at boot. The chat
route will fail on actual use (which is fine for now), and invite emails
won't send (the invite rows still get created — you can grab tokens
directly from the database).

---

## 4 · Run the web app

```bash
# From the repo root
pnpm --filter @yeyak/web dev
```

Open http://localhost:3000 — you should land on `/login`.

Sign in with the admin email + password you created in step 2.

### What will work

- **/login** — sign in
- **/** — chat home. The 4-card entry grid renders. Clicking a seed
  ("Help me discover…") sends a message — **this will error** with
  "Agent request failed" because Anthropic isn't wired. That's expected.
- **/bookings** — empty state with "No active tasks"
- **/settings** — display name, Resy fields, notification toggles,
  save and sign-out
- **/admin** — dashboards will show zeros
- **/admin/users** — you'll see yourself; invite form will submit but
  the email won't send (the invite row is still created in the DB)

### What will error (expected)

- Sending a chat message (no Anthropic key)
- Any booking/search attempt (no Apify)
- The invite email body (but the invite row is created — you can copy
  `invites.token` and visit `/invite/<token>` manually to test that flow)

---

## 5 · Testing the invite flow without Resend

1. On **/admin/users**, submit an email like `test@example.com`.
2. Open Supabase → **Table Editor** → **invites** — copy the `token`.
3. In an incognito tab, visit `http://localhost:3000/invite/<paste-token>`.
4. Fill in the form → you become a new user via Supabase Auth.

---

## 6 · When you're ready for chat

Add your real `ANTHROPIC_API_KEY` to `.env.local`, restart dev
(`Ctrl+C` then `pnpm --filter @yeyak/web dev` again), and the agent
route will respond. Without Apify, though, the agent's tools will still
fail — so conversations will be limited to "I can't reach Resy right
now" messages.

Add `APIFY_API_TOKEN` after that and full agent + booking works.

---

## 7 · Running the worker (last)

```bash
# In a separate terminal — needs local Redis:
#   brew install redis && brew services start redis
cd apps/worker
cp .env.example .env
# fill in SUPABASE_*, APIFY_API_TOKEN, REDIS_URL=redis://localhost:6379
pnpm --filter @yeyak/worker dev
```

You should see `[worker] yeyak-sniper up, cron=0,30 * * * *`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Environment variables are missing or invalid` on first page load | Check `apps/web/.env.local` — every var in `lib/env.ts` must be set (placeholders are fine for now) |
| Redirect loop at /login | You're signed in but no `profiles` row exists. Visit the Supabase Table Editor and insert one manually for your user, or sign out + sign up via the Auth panel |
| `infinite recursion detected in policy for relation "profiles"` | One of the RLS policies references `profiles` from within a `profiles` policy. Verify `supabase/schema.sql` was pasted wholesale — the admin-read policy uses `exists (…from public.profiles p …)` with an alias to avoid this |
| TypeScript errors after install | Run `pnpm --filter @yeyak/types build` first so the workspace alias resolves |
