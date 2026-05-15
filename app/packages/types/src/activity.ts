/**
 * Activity log — append-only event stream for the admin dashboard.
 */
export type ActivityEventType =
  | "search"
  | "task_created"
  | "task_cancelled"
  | "booking_confirmed"
  | "booking_cancelled"
  | "sniper_poll"
  | "sniper_booked"
  | "login"
  | "invite_sent";

export interface ActivityEvent {
  id: string;
  user_id: string | null;
  event_type: ActivityEventType;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
