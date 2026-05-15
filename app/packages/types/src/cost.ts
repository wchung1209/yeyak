/**
 * Cost events — an audit trail of billable Apify calls.
 * Written before each call (optimistic logging). If the call fails,
 * `failed` is flipped to true so we can reconcile against Apify invoices.
 */
export type CostAction = "search" | "check_availability" | "book";
export type CostSource = "agent" | "sniper";

export interface CostEvent {
  id: string;
  user_id: string | null;
  action: CostAction;
  cost_usd: number;
  venue_id: string | null;
  restaurant_name: string | null;
  session_id: string | null;
  source: CostSource;
  failed: boolean;
  created_at: string;
}

/**
 * Single source of truth for Apify pricing.
 * Values match the architecture doc (check values against Apify dashboard).
 */
export const APIFY_COSTS = {
  search: 0.03,
  check_availability: 0.05,
  book: 3.99,
} as const satisfies Record<CostAction, number>;
