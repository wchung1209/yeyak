/**
 * Supabase activity ping.
 *
 * Free-tier Supabase projects pause after ~1 week with no traffic. This
 * script connects with the service-role key and runs a cheap
 * `SELECT count(*)` against every public table to keep the project alive.
 * Read-only, idempotent, costs nothing.
 *
 * Usage (from the repo root):
 *   pnpm ping:supabase
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from process
 * env or, as a fallback, from `apps/web/.env.local`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const TABLES = [
  "profiles",
  "invites",
  "reservation_tasks",
  "reservations",
  "cost_events",
  "activity_log",
] as const;

function envFromFile(name: string): string | null {
  const envPath = join(process.cwd(), "apps/web/.env.local");
  if (!existsSync(envPath)) return null;
  const re = new RegExp(`^${name}=(.*)$`, "m");
  const match = readFileSync(envPath, "utf8").match(re);
  const raw = match?.[1]?.trim();
  if (!raw || raw === "placeholder") return null;
  return raw.replace(/^["']|["']$/g, "");
}

function loadEnv(name: string): string | null {
  return process.env[name] ?? envFromFile(name);
}

async function main() {
  const url = loadEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = loadEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceKey) {
    console.error(
      "Missing Supabase env vars. Need NEXT_PUBLIC_SUPABASE_URL + " +
        "SUPABASE_SERVICE_ROLE_KEY (in env or apps/web/.env.local).",
    );
    process.exit(1);
  }

  console.log(`Pinging ${url} …`);
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  let ok = 0;
  let failed = 0;

  for (const table of TABLES) {
    const start = Date.now();
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    const ms = Date.now() - start;

    if (error) {
      console.error(`  ✗ ${table.padEnd(20)}  ${error.message}`);
      failed += 1;
    } else {
      console.log(`  ✓ ${table.padEnd(20)}  ${String(count).padStart(6)} rows  (${ms}ms)`);
      ok += 1;
    }
  }

  console.log(`\nDone — ${ok} ok, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n✗ Ping crashed:");
  console.error(err);
  process.exit(1);
});
