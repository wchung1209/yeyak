/**
 * Per-session cache lookup over `public.tool_call_log`.
 *
 * Why: the LLM agent will sometimes re-verify a `check_availability`
 * call multiple times in a single conversation despite the prompt
 * telling it not to (defensive bias before booking). Each redundant
 * call is $0.05 and a visible "Checking availability…" spinner. We
 * defend by short-circuiting at the package layer: if the SAME wire
 * args were already called in the SAME session in the last N minutes
 * and succeeded, return that prior result without hitting Resy or
 * writing a new cost_event.
 *
 * Equality is checked Postgres-side. JS-side `JSON.stringify` is not
 * a reliable comparison because Postgres jsonb may re-order keys on
 * storage/retrieval — '{"a":1,"b":2}' inserted can come back as
 * '{"b":2,"a":1}'. Using `.eq("args", wireArgs)` makes Postgres do
 * the jsonb-equality compare, which is order-independent.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_MAX_AGE_MINUTES = 15;
const DEBUG_PREFIX = "[resy-cache]";

export interface CacheLookupArgs {
  supabase: SupabaseClient;
  sessionId: string | undefined;
  toolName: string;
  /** Wire-shape args, exactly as the ToolCallLogger will have stored them. */
  wireArgs: object;
  /** Defaults to 15 minutes. */
  maxAgeMinutes?: number;
}

/**
 * Returns the cached `result` payload (wire shape, JSON) if a recent
 * matching call exists; otherwise null.
 */
export async function findCachedToolResult(
  opts: CacheLookupArgs,
): Promise<unknown | null> {
  if (!opts.sessionId) {
    console.log(`${DEBUG_PREFIX} skip — no sessionId for ${opts.toolName}`);
    return null;
  }
  const maxAge = opts.maxAgeMinutes ?? DEFAULT_MAX_AGE_MINUTES;
  const since = new Date(Date.now() - maxAge * 60_000).toISOString();

  // PostgREST jsonb equality requires the value as a JSON-encoded string;
  // passing an object directly causes supabase-js to coerce it to
  // "[object Object]" and Postgres errors with "invalid input syntax for
  // type json". `.filter("col", "eq", JSON.stringify(...))` sends the
  // payload correctly. Postgres then casts to jsonb and compares
  // jsonb-to-jsonb, which is key-order independent.
  const argsJson = JSON.stringify(opts.wireArgs);
  const { data, error } = await opts.supabase
    .from("tool_call_log")
    .select("result")
    .eq("session_id", opts.sessionId)
    .eq("tool_name", opts.toolName)
    .filter("args", "eq", argsJson)
    .gte("created_at", since)
    .is("error_kind", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error(`${DEBUG_PREFIX} lookup failed for ${opts.toolName}`, error);
    return null;
  }
  if (!data || data.length === 0) {
    console.log(
      `${DEBUG_PREFIX} miss — ${opts.toolName} session=${opts.sessionId} args=${JSON.stringify(opts.wireArgs)}`,
    );
    return null;
  }
  console.log(
    `${DEBUG_PREFIX} hit — ${opts.toolName} session=${opts.sessionId}`,
  );
  return data[0]!.result;
}
