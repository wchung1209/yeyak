/**
 * User profile — mirrors `public.profiles` row.
 *
 * The user's Resy password lives in Supabase Vault. `resy_password_secret_id`
 * is the row's pointer into `vault.secrets`. Reads go through the service-
 * role-only RPC `public.get_resy_password(uuid)`; writes go through the
 * authenticated RPC `public.set_resy_password(text)`. The plaintext never
 * crosses Postgres.
 */
export type UserRole = "admin" | "user";

export interface Profile {
  id: string;
  display_name: string | null;
  role: UserRole;
  resy_email: string | null;
  /** Vault secret id; null when the user hasn't set a Resy password. */
  resy_password_secret_id: string | null;
  notify_email: boolean;
  notify_sms: boolean;
  phone: string | null;
  /** User defaults injected into the agent system prompt. All nullable. */
  default_city: string | null;
  default_party_size: number | null;
  /** HH:MM:SS, e.g. "18:00:00". */
  default_dinner_start: string | null;
  default_dinner_end: string | null;
  default_lunch_start: string | null;
  default_lunch_end: string | null;
  /** IANA tz name, defaults server-side to "America/New_York". */
  timezone: string;
  /** True once the user has connected Resy or explicitly skipped onboarding. */
  onboarding_completed: boolean;
  created_at: string;
}

/** Shape safe to expose to the browser. The secret id is opaque, but we
 * still strip it so the client only ever sees a boolean presence flag. */
export type PublicProfile = Omit<Profile, "resy_password_secret_id"> & {
  has_resy_credentials: boolean;
};

export interface Invite {
  id: string;
  email: string;
  invited_by: string | null;
  token: string;
  accepted: boolean;
  created_at: string;
  expires_at: string;
}
