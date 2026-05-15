/**
 * Typed surface for the `clearpath/resy-booker` Apify MCP server.
 *
 * The actor is not a traditional run-and-return Apify actor — it's an MCP
 * server (Standby mode). Endpoint:
 *
 *   POST https://clearpath--resy-booker.apify.actor/mcp
 *   Authorization: Bearer <APIFY_API_TOKEN>
 *
 * The server exposes six tools: login, search_restaurants, check_availability,
 * book_reservation, my_reservations, cancel_reservation.
 *
 * Ground truth for these types is `docs/apify-samples/` — real probe output.
 * If the actor's shape ever changes, refresh the samples and update this file
 * in one place.
 *
 * Layering:
 *   • "Wire" types (snake_case) mirror exactly what crosses the wire. They
 *     are what the MCP client sends & parses.
 *   • "Domain" types (camelCase) are what the rest of Yeyak consumes —
 *     agent tools, worker, UI, DB. Translation happens in the MCP client
 *     (see `apps/web/lib/resy/mcp-client.ts`).
 *
 * Only the domain types should escape beyond the client module.
 */

// ═════════════════════════════════════════════════════════════════════
// TOOL NAMES
// ═════════════════════════════════════════════════════════════════════

export const RESY_TOOL = {
  login: "login",
  search: "search_restaurants",
  checkAvailability: "check_availability",
  book: "book_reservation",
  myReservations: "my_reservations",
  cancel: "cancel_reservation",
} as const;

export type ResyToolName = (typeof RESY_TOOL)[keyof typeof RESY_TOOL];

// ═════════════════════════════════════════════════════════════════════
// WIRE TYPES — exact shapes from docs/apify-samples/
// ═════════════════════════════════════════════════════════════════════

/**
 * Some tools return `structuredContent.result: [...]` (FastMCP wrapper),
 * others return `structuredContent` as the payload directly. The fields
 * below document which is which.
 */

// ─── login ──────────────────────────────────────────────────────────
export interface ResyWireLoginInput {
  email: string;
  password: string;
}

export interface ResyWireLoginSuccess {
  success: true;
  user_name: string;
  email: string;
}

export interface ResyWireLoginFailure {
  success: false;
  error: string;
}

export type ResyWireLoginOutput = ResyWireLoginSuccess | ResyWireLoginFailure;

// ─── search_restaurants ─────────────────────────────────────────────
export interface ResyWireSearchInput {
  city: string;
  cuisine?: string | null;
  query?: string | null;
  /** YYYY-MM-DD */
  date?: string | null;
  party_size?: number;
  limit?: number;
  sort?: "relevance" | "rating" | "slots" | "name";
}

/** One available time slot on a venue. Used by search + check_availability. */
export interface ResyWireSlot {
  /** "YYYY-MM-DD HH:MM:SS" (space separator, not ISO). */
  time: string;
  /** e.g. "Dining Room", "Bar", "Outdoor". */
  type: string;
  /**
   * Opaque `rgs://resy/...` string. Pass verbatim to `book_reservation`
   * as `config_token`.
   */
  token: string;
}

export interface ResyWireVenue {
  id: number;
  name: string;
  /** Full Resy URL, e.g. https://resy.com/cities/new-york-ny/le-gratin */
  url: string;
  neighborhood: string | null;
  cuisine: string[];
  /** 1–4 */
  priceRange: number;
  /** Float, typically 0–5. */
  rating: number;
  slots: ResyWireSlot[];
  slotCount: number;
}

/** FastMCP wraps this as `{ result: ResyWireVenue[] }`. */
export type ResyWireSearchOutput = ResyWireVenue[];

// ─── check_availability ─────────────────────────────────────────────
export interface ResyWireCheckAvailabilityInput {
  /** Full Resy URL, not a slug. */
  restaurant_url: string;
  /** YYYY-MM-DD */
  date?: string | null;
  party_size?: number;
}

/** Not FastMCP-wrapped — returns a single venue directly. */
export type ResyWireCheckAvailabilityOutput = ResyWireVenue;

// ─── book_reservation ───────────────────────────────────────────────
export interface ResyWireBookInput {
  /** The `token` from a slot in search/check_availability output. */
  config_token: string;
}

/**
 * Shape assumed from the tool description + Resy's public API conventions.
 * Probe it with a real $3.99 booking before production; until then, we only
 * rely on `success` + `resy_token` fields.
 */
export interface ResyWireBookSuccess {
  success: true;
  resy_token: string;
  /** Everything else the actor returns — preserved so we can mine it later. */
  [key: string]: unknown;
}

export interface ResyWireBookFailure {
  success: false;
  error: string;
}

export type ResyWireBookOutput = ResyWireBookSuccess | ResyWireBookFailure;

// ─── my_reservations ────────────────────────────────────────────────
export type ResyWireMyReservationsInput = Record<string, never>;

export interface ResyWireReservation {
  restaurant: string;
  venue_id: number;
  /** YYYY-MM-DD */
  date: string;
  /** "HH:MM:SS" */
  time: string;
  party_size: number;
  /** e.g. "Dining Room". */
  type: string;
  /**
   * Opaque identifier — used as input to `cancel_reservation`. Not the
   * same as the booking's `config_token`.
   */
  resy_token: string;
}

/** FastMCP wraps this as `{ result: ResyWireReservation[] }`. */
export type ResyWireMyReservationsOutput = ResyWireReservation[];

// ─── cancel_reservation ─────────────────────────────────────────────
export interface ResyWireCancelInput {
  resy_token: string;
}

export interface ResyWireCancelSuccess {
  success: true;
  [key: string]: unknown;
}
export interface ResyWireCancelFailure {
  success: false;
  error: string;
}
export type ResyWireCancelOutput = ResyWireCancelSuccess | ResyWireCancelFailure;

// ═════════════════════════════════════════════════════════════════════
// DOMAIN TYPES — what the rest of Yeyak consumes
// ═════════════════════════════════════════════════════════════════════

/**
 * Resy account credentials. The MCP server doesn't issue a reusable session
 * token — each new MCP connection must call `login` again. We therefore
 * store the encrypted password in Supabase Vault and re-authenticate on
 * every worker job and agent turn that needs an authenticated call.
 */
export interface ResyCredentials {
  email: string;
  password: string;
}

/** A single bookable slot on a venue. */
export interface ResySlot {
  /** Pass verbatim to `book()`. */
  configToken: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24h), venue-local. */
  time: string;
  /** e.g. "Dining Room". */
  type: string;
}

/** Venue with its currently-available slots. */
export interface ResyVenue {
  /** Numeric Resy venue id — store as string in DB to avoid precision loss. */
  venueId: string;
  name: string;
  /** Canonical Resy URL. */
  url: string;
  neighborhood: string | null;
  cuisine: string[];
  /** 1–4. */
  priceRange: number;
  /** 0–5 float. */
  rating: number;
  slots: ResySlot[];
}

/** A Resy reservation on the user's account. */
export interface ResyReservation {
  /** Use as input to `cancel()`. */
  resyToken: string;
  venueId: string;
  restaurantName: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24h). */
  time: string;
  partySize: number;
  type: string;
}

/** Return type from a successful booking. */
export interface ResyBookingResult {
  /** Use as input to `cancel()`. */
  resyToken: string;
  venueId: string;
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
  /** Raw payload from the actor, preserved for activity_log. */
  raw: Record<string, unknown>;
}

// ═════════════════════════════════════════════════════════════════════
// WIRE ↔ DOMAIN ADAPTERS
// ═════════════════════════════════════════════════════════════════════

/**
 * Actor timestamps are "YYYY-MM-DD HH:MM:SS" (space separator). This helper
 * splits them into separate `date` / `time` fields. `time` is truncated to
 * HH:MM so it matches the DB schema.
 */
function splitWireTime(wire: string): { date: string; time: string } {
  const [date = "", rest = ""] = wire.split(" ");
  const time = rest.slice(0, 5); // "HH:MM"
  return { date, time };
}

function mapWireSlot(wire: ResyWireSlot): ResySlot {
  const { date, time } = splitWireTime(wire.time);
  return { configToken: wire.token, date, time, type: wire.type };
}

export function mapWireVenue(wire: ResyWireVenue): ResyVenue {
  return {
    venueId: String(wire.id),
    name: wire.name,
    url: wire.url,
    neighborhood: wire.neighborhood,
    cuisine: wire.cuisine,
    priceRange: wire.priceRange,
    rating: wire.rating,
    slots: wire.slots.map(mapWireSlot),
  };
}

export function mapWireReservation(wire: ResyWireReservation): ResyReservation {
  return {
    resyToken: wire.resy_token,
    venueId: String(wire.venue_id),
    restaurantName: wire.restaurant,
    date: wire.date,
    time: wire.time.slice(0, 5),
    partySize: wire.party_size,
    type: wire.type,
  };
}
