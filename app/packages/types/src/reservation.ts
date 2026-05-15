/**
 * Confirmed reservations.
 */
export type ReservationStatus = "confirmed" | "cancelled";
export type BookedBy = "agent" | "sniper" | "manual";
export type Platform = "resy";

export interface Reservation {
  id: string;
  user_id: string;
  task_id: string | null;
  platform: Platform;
  /** Resy reservation/resToken id */
  platform_id: string | null;
  restaurant_name: string;
  venue_id: string | null;
  /** ISO date */
  date: string;
  /** HH:MM:SS */
  time: string;
  party_size: number;
  status: ReservationStatus;
  booked_by: BookedBy;
  booked_at: string;
  raw_data: Record<string, unknown> | null;
}
