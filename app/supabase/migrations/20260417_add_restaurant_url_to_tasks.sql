-- Adds `restaurant_url` to reservation_tasks.
--
-- Why: the Apify MCP `check_availability` tool takes a full Resy URL
-- (e.g. https://resy.com/cities/new-york-ny/le-gratin), not a numeric
-- venue id. The sniper worker polls availability per task, so the URL
-- must live on the task row.
--
-- Apply via Supabase Studio SQL editor or `supabase db push`.

alter table public.reservation_tasks
  add column if not exists restaurant_url text;

-- Existing rows (created before this migration) won't have a URL. The
-- worker should skip tasks where restaurant_url is null and log a warning.
