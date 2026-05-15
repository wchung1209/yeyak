/**
 * Resy login round-trip probe.
 *
 * Verifies the end-to-end credential path:
 *   1. Read the user's Resy email + Vault-stored password from Postgres
 *      (via the same `fetchResyCredentials` the agent + worker use).
 *   2. Open an MCP session against the live Apify actor.
 *   3. Call `login(email, password)` and report whether it succeeded.
 *   4. As a tiny smoke test, also call `my_reservations` (free, requires
 *      a successful login) and print how many reservations the account
 *      has — proves the session is actually authenticated, not just that
 *      `login` returned `success: true`.
 *
 * Usage from the repo root:
 *   pnpm probe:resy-login                 # picks the only profile with creds
 *   pnpm probe:resy-login -- <user-uuid>  # explicit user
 *
 * Reads APIFY_API_TOKEN + Supabase env from process.env or apps/web/.env.local.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchResyCredentials, withResySession } from "@yeyak/resy";

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

async function pickUserId(
  supabase: ReturnType<typeof createClient>,
  argv: string[],
): Promise<string> {
  const explicit = argv.find((a) => /^[0-9a-f-]{36}$/i.test(a));
  if (explicit) return explicit;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, resy_email, resy_password_secret_id");
  if (error) throw new Error(`profiles fetch failed: ${error.message}`);

  const withCreds = (data ?? []).filter(
    (p) => p.resy_email && p.resy_password_secret_id,
  );
  if (withCreds.length === 0) {
    throw new Error(
      "No profile has Resy credentials set. Visit /settings to connect Resy first.",
    );
  }
  if (withCreds.length > 1) {
    throw new Error(
      `Multiple profiles have credentials (${withCreds.length}). Pass a user id explicitly: ` +
        `pnpm probe:resy-login -- <uuid>`,
    );
  }
  return withCreds[0]!.id as string;
}

async function main() {
  const url = loadEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = loadEnv("SUPABASE_SERVICE_ROLE_KEY");
  const apifyToken = loadEnv("APIFY_API_TOKEN");

  if (!url || !serviceKey || !apifyToken) {
    console.error(
      "Missing env. Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + APIFY_API_TOKEN.",
    );
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const userId = await pickUserId(supabase, process.argv.slice(2));
  console.log(`Probing Resy login for user ${userId} …`);

  const credentials = await fetchResyCredentials(supabase, userId);
  if (!credentials) {
    console.error(
      "✗ fetchResyCredentials returned null — either the email or the vault secret is missing.",
    );
    process.exit(1);
  }
  console.log(`  ✓ credentials loaded (email: ${credentials.email})`);

  const start = Date.now();
  await withResySession(
    {
      apifyToken,
      supabase,
      source: "agent",
      userId,
      sessionId: "login-probe",
    },
    credentials,
    async (resy) => {
      // Login is now lazy inside withResySession — calling an
      // authenticated tool triggers it. `myReservations` is the cheapest
      // authenticated tool, so it doubles as a login probe.
      const reservations = await resy.myReservations();
      const elapsed = Date.now() - start;
      console.log(
        `  ✓ login + my_reservations returned ${reservations.length} reservation(s) (${elapsed}ms)`,
      );
    },
  );

  console.log("\nDone — login round-trip works.");
}

main().catch((err) => {
  console.error("\n✗ Probe failed:");
  if (err && typeof err === "object" && "kind" in err) {
    console.error(`  kind: ${(err as { kind: unknown }).kind}`);
  }
  console.error(err);
  process.exit(1);
});
