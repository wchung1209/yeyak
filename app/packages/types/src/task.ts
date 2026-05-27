/**
 * Reservation tasks — the "sniper jobs" the worker polls on a cron.
 */
export type TaskStatus = "active" | "booked" | "cancelled" | "expired";

export interface ReservationTask {
  id: string;
  user_id: string;
  venue_id: string;
  restaurant_name: string;
  /**
   * Full Resy URL — needed by the worker to call check_availability.
   * Nullable for rows created before the URL migration; the worker
   * skips those.
   */
  restaurant_url: string | null;
  /** ISO date `YYYY-MM-DD` — start of the watch range (inclusive). */
  target_date: string;
  /**
   * ISO date `YYYY-MM-DD` — end of the watch range (inclusive).
   * `null` means single-day (equivalent to `target_date_end = target_date`).
   * The worker iterates [target_date..target_date_end] each cron tick
   * and books the first slot that matches.
   */
  target_date_end: string | null;
  /** HH:MM:SS */
  time_start: string;
  /** HH:MM:SS */
  time_end: string;
  party_size: number;
  status: TaskStatus;
  notify_only: boolean;
  created_at: string;
  resolved_at: string | null;
  last_checked_at: string | null;
}

export interface CreateTaskInput {
  venue_id: string;
  restaurant_name: string;
  restaurant_url: string;
  /** Single date or start of the range. */
  target_date: string;
  /** Optional end of the range (inclusive). Omit for single-day. */
  target_date_end?: string;
  time_start: string;
  time_end: string;
  party_size: number;
  notify_only?: boolean;
}
