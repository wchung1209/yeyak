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
  /** ISO date `YYYY-MM-DD` */
  target_date: string;
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
  target_date: string;
  time_start: string;
  time_end: string;
  party_size: number;
  notify_only?: boolean;
}
