/**
 * Fetch a user's Resy credentials.
 *
 * The Apify MCP server doesn't issue reusable session tokens — each MCP
 * connection has to call `login(email, password)`. We store `resy_email`
 * on `public.profiles` and the password in Supabase Vault, accessed via
 * `public.get_resy_password(uuid)` (a SECURITY DEFINER RPC granted only
 * to `service_role`).
 *
 * Callers MUST pass a service-role Supabase client. An anon/user client
 * will get a permission error from the RPC.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResyCredentials } from "@yeyak/types";

export async function fetchResyCredentials(
  supabase: SupabaseClient,
  userId: string,
): Promise<ResyCredentials | null> {
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("resy_email, resy_password_secret_id")
    .eq("id", userId)
    .single();
  if (profileErr || !profile?.resy_email || !profile?.resy_password_secret_id) {
    return null;
  }

  const { data: password, error: rpcErr } = await supabase.rpc(
    "get_resy_password",
    { p_user_id: userId },
  );
  if (rpcErr) {
    console.error("[resy/credentials] get_resy_password RPC failed", rpcErr);
    return null;
  }
  if (typeof password !== "string" || password.length === 0) {
    return null;
  }

  return { email: profile.resy_email, password };
}
