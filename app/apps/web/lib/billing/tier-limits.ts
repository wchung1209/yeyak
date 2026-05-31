/**
 * Tier helpers — sniper limit lookups, used by the agent tool pre-flight
 * and by any UI that surfaces "X of Y monitors" to the user.
 *
 * The DB trigger enforce_sniper_tier_limits is the source of truth for
 * enforcement. This module mirrors the same data so the UI / agent can
 * surface friendly messages BEFORE hitting the trigger.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface TierLimits {
  tier: string;
  maxActiveSniperTasks: number;
  maxSniperDateRangeDays: number;
}

/**
 * Conservative defaults — only used if both the profile lookup and the
 * tier_limits row are missing. Mirrors the free tier seeded by the
 * migration so the agent never accidentally grants a wider window than
 * the trigger will allow.
 */
const FALLBACK_LIMITS: TierLimits = {
  tier: "free",
  maxActiveSniperTasks: 2,
  maxSniperDateRangeDays: 1,
};

/**
 * Load the user's effective tier + numeric caps. Returns the fallback
 * silently on any lookup miss; the trigger is still the authoritative
 * gate.
 */
export async function loadTierLimits(
  supabase: SupabaseClient,
  userId: string,
): Promise<TierLimits> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("tier")
    .eq("id", userId)
    .single();

  const tier = (profile?.tier as string | undefined) ?? "free";

  const { data: row } = await supabase
    .from("tier_limits")
    .select("tier, max_active_sniper_tasks, max_sniper_date_range_days")
    .eq("tier", tier)
    .single();

  if (!row) return FALLBACK_LIMITS;

  return {
    tier: row.tier as string,
    maxActiveSniperTasks: row.max_active_sniper_tasks as number,
    maxSniperDateRangeDays: row.max_sniper_date_range_days as number,
  };
}

/**
 * Count this user's currently-active monitors. Used by the create-task
 * pre-flight and by the Settings UI.
 */
export async function countActiveSniperTasks(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count } = await supabase
    .from("reservation_tasks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");
  return count ?? 0;
}

/**
 * Compute inclusive day count from a start + optional end ISO date.
 * Single-day (end null or equal start) returns 1.
 */
export function rangeDays(start: string, end: string | null | undefined): number {
  if (!end || end === start) return 1;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 1;
  return Math.max(1, Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1);
}
