/**
 * Server-side Supabase helpers for Route Handlers, Server Components,
 * and Server Actions. Uses the `cookies()` store for session persistence.
 *
 * There are two flavours:
 *  - createSupabaseServerClient()  — acts as the signed-in user (RLS enforced)
 *  - createSupabaseServiceClient() — service-role key, bypasses RLS.
 *    Only use for trusted server-side operations (admin tasks, cost logging).
 */
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(newCookies: CookieToSet[]) {
        try {
          newCookies.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // `cookies().set` throws in Server Components; safe to ignore
          // because middleware will refresh the session cookie separately.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS. NEVER expose this to the browser.
 */
export function createSupabaseServiceClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
