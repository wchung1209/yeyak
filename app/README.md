# Yeyak

Invite-only reservation concierge — chat with an AI maître d' to discover
restaurants and snipe reservations on Resy the moment a slot opens.

> 예약 (*yeyak*) — "to reserve" in Korean.

## Repo layout

```
yeyak/
├── apps/
│   ├── web/       Next.js 14 app (Vercel)
│   └── worker/    BullMQ sniper (Railway)
├── packages/
│   └── types/     Shared TypeScript types
└── supabase/
    └── schema.sql
```

## Quick start

```bash
# 1. Install
corepack enable
pnpm install

# 2. Provision Supabase
#    - create a new project at supabase.com
#    - open the SQL editor and paste supabase/schema.sql
#    - copy the URL, anon key, and service role key into apps/web/.env.local

# 3. Fill in credentials
cp apps/web/.env.example apps/web/.env.local
cp apps/worker/.env.example apps/worker/.env

# 4. Run the web app
pnpm --filter @yeyak/web dev

# 5. Run the worker (separate terminal, Redis running locally or via Railway)
pnpm --filter @yeyak/worker dev
```

## Deployment

**Vercel (web)** — import the repo, set the root directory to `apps/web`,
and add all env vars from `apps/web/.env.example`. Vercel auto-detects
Next.js 14.

**Railway (worker)** — create a new project, add the Redis plugin, set
the root directory to `apps/worker`, and configure env vars from
`apps/worker/.env.example`. Start command: `pnpm start`.

## The sniper engine

The worker polls Resy every hour on the hour (`0 * * * *`) for every
active reservation task and **auto-books the first slot that lands
inside the user's window** — no further confirmation. Cost per poll is
$0.05 (one availability check) plus $3.99 once the booking actually
fires. At 24 polls/day the steady-state cost per active task is
~$1.20/day; once the booking lands the task flips to `booked` and stops
billing.

> **Important:** the worker is a separate process. Without a deployed
> worker (Railway + Redis, or `pnpm --filter @yeyak/worker dev` locally
> with a Redis instance reachable via `REDIS_URL`), tasks accumulate in
> Postgres but nothing polls them. Auto-book never fires until the
> worker is actually running.

## Architecture map

| Concern | Where |
|---|---|
| Auth + session | `apps/web/middleware.ts`, `apps/web/lib/supabase/*` |
| Agent system prompt | `apps/web/lib/agent/prompts.ts` |
| Agent tool wiring | `apps/web/lib/agent/tools.ts` |
| Streaming agent route | `apps/web/app/api/agent/route.ts` |
| Resy MCP client + cost logging | `packages/resy/src/mcp-client.ts` |
| Chat UI | `apps/web/components/agent/*` |
| Sniper cron | `apps/worker/index.ts` |
| Sniper logic | `apps/worker/jobs/sniperJob.ts` |
| DB schema | `supabase/schema.sql` |
| Shared types | `packages/types/src/*` |

## Notes on the Resy MCP server

The `clearpath/resy-booker` Apify actor runs in **MCP Standby** mode
(streaming HTTP) rather than as a one-shot actor run. Yeyak talks to it
through `@modelcontextprotocol/sdk` — see `packages/resy/src/mcp-client.ts`.

Wire and domain types both live in `packages/types/src/resy.ts`. The
`ResyWire*` types mirror exact tool I/O; `Resy*` types are camelCase
domain shapes that the rest of the app consumes. Adapter functions in
the same file translate between the two.

## Security

- Row-level security is enabled on every user-facing table.
- The user's Resy password lives in **Supabase Vault**.
  `profiles.resy_password_secret_id` stores the row's pointer into
  `vault.secrets`. The plaintext never crosses Postgres in normal
  operation: writes go through `public.set_resy_password(text)`
  (authenticated), reads through `public.get_resy_password(uuid)`
  (service-role only). The shared client is `fetchResyCredentials` in
  `packages/resy/src/credentials.ts`.
- The worker uses the service-role key (bypasses RLS) which is why it
  must never ship in a client bundle.

## Open TODOs

- [x] Move Resy password to Supabase Vault
- [ ] Wire the agent's search results to render `RestaurantCard` in chat
- [ ] Implement the `ConfirmBookingCard` gating flow end-to-end in
      `ChatShell` (currently the confirm card component is wired but the
      state machine that intercepts `book_reservation` tool calls is a TODO)
- [ ] Add E2E tests (Playwright) for the invite + book flow
- [ ] Configure Supabase auth email templates to match Yeyak branding
