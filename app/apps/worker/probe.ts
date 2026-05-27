/**
 * Sniper probe — runs ONE cycle of the sniper logic directly,
 * bypassing BullMQ and Redis entirely. Useful for force-firing the
 * cron from a terminal without waiting for the top of the next hour.
 *
 * Usage (from repo root):
 *   pnpm --filter @yeyak/worker run probe
 *
 * Env: same as the worker proper minus REDIS_URL.
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APIFY_API_TOKEN
 *
 * Reads them from process.env or, as a fallback, from apps/worker/.env.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runSniperCycle } from "./jobs/sniperJob.js";

function envFromFile(name: string): string | null {
  // Resolve relative to this file so it works regardless of cwd.
  const candidates = [
    join(process.cwd(), ".env"),
    join(process.cwd(), "apps/worker/.env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const re = new RegExp(`^${name}=(.*)$`, "m");
    const match = readFileSync(path, "utf8").match(re);
    const raw = match?.[1]?.trim();
    if (!raw || raw === "placeholder") continue;
    return raw.replace(/^["']|["']$/g, "");
  }
  return null;
}

function loadEnv(name: string): string | null {
  return process.env[name] ?? envFromFile(name);
}

function rangeLabel(t: {
  target_date: string;
  target_date_end: string | null;
}): string {
  return t.target_date_end && t.target_date_end !== t.target_date
    ? `${t.target_date}…${t.target_date_end}`
    : t.target_date;
}

async function main() {
  const url = loadEnv("SUPABASE_URL");
  const key = loadEnv("SUPABASE_SERVICE_ROLE_KEY");
  const apifyToken = loadEnv("APIFY_API_TOKEN");
  if (!url || !key || !apifyToken) {
    console.error(
      "Missing env. Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + APIFY_API_TOKEN " +
        "(in env or apps/worker/.env).",
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ─── Snapshot before ──────────────────────────────────────────────
  const { data: before, error: beforeErr } = await supabase
    .from("reservation_tasks")
    .select(
      "id, restaurant_name, target_date, target_date_end, time_start, time_end, party_size, status, last_checked_at",
    )
    .eq("status", "active");
  if (beforeErr) {
    console.error("Could not list tasks:", beforeErr.message);
    process.exit(1);
  }

  console.log(`Active tasks before: ${before?.length ?? 0}`);
  for (const t of before ?? []) {
    console.log(
      `  • ${t.restaurant_name.padEnd(35)} ${rangeLabel(t)}  ${t.time_start.slice(0, 5)}–${t.time_end.slice(0, 5)}  party=${t.party_size}`,
    );
  }

  // ─── Run one cycle ────────────────────────────────────────────────
  console.log("\n▶ Running one sniper cycle…\n");
  const start = Date.now();
  try {
    await runSniperCycle({ supabase, apifyToken });
  } catch (err) {
    console.error("\n✗ Sniper cycle crashed:", err);
    process.exit(1);
  }
  const elapsed = Date.now() - start;
  console.log(`\n✓ Cycle finished in ${elapsed}ms\n`);

  // ─── Snapshot after ───────────────────────────────────────────────
  const { data: after } = await supabase
    .from("reservation_tasks")
    .select(
      "id, restaurant_name, target_date, target_date_end, status, last_checked_at, resolved_at",
    )
    .in("status", ["active", "booked", "expired"])
    .order("created_at", { ascending: false })
    .limit(20);

  const beforeById = new Map(before?.map((t) => [t.id, t]) ?? []);
  console.log("Task status after:");
  for (const t of after ?? []) {
    const wasActive = beforeById.has(t.id);
    if (!wasActive && t.status === "active") continue;
    const flag =
      wasActive && t.status !== "active"
        ? `  ⚑ flipped active → ${t.status}`
        : "";
    console.log(
      `  • ${t.restaurant_name.padEnd(35)} ${rangeLabel(t)}  ${t.status}${flag}`,
    );
  }

  // ─── Did anything book? ───────────────────────────────────────────
  const { data: booked } = await supabase
    .from("reservations")
    .select("id, restaurant_name, date, time, party_size, created_at")
    .eq("booked_by", "sniper")
    .gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString())
    .order("created_at", { ascending: false });
  if (booked && booked.length > 0) {
    console.log("\n🎉 Sniper booked the following in the last 5 minutes:");
    for (const r of booked) {
      console.log(
        `  • ${r.restaurant_name} · ${r.date} ${String(r.time).slice(0, 5)} · party=${r.party_size}`,
      );
    }
  } else {
    console.log("\nNo new sniper bookings in the last 5 minutes.");
  }
}

main().catch((err) => {
  console.error("\n✗ Probe failed:");
  console.error(err);
  process.exit(1);
});
