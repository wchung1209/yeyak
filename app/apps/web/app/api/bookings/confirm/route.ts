/**
 * POST /api/bookings/confirm
 *
 * Actually books a reservation after the user clicks "Confirm & book" in
 * the ConfirmBookingCard. The agent's `book_reservation` tool only
 * returns a pending-confirmation payload; this route is the single place
 * where Resy's paid booking call is actually invoked.
 *
 * Request body:
 *   {
 *     configToken:    string,   // opaque slot token from check_availability
 *     venueId:        string,
 *     restaurantName: string,
 *     date:           string,   // YYYY-MM-DD
 *     time:           string,   // HH:MM
 *     partySize:      number,
 *     taskId?:        string    // optional — mark a monitoring task as booked
 *   }
 *
 * Responses:
 *   200 { reservation: { id, restaurantName, date, time, partySize, resyToken } }
 *   400 { error: string }   — validation / missing creds / Resy error
 *   401 { error: "Unauthorized" }
 *   500 { error: string }   — succeeded on Resy but failed to persist
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { withResySession, ResyMcpError, fetchResyCredentials } from "@yeyak/resy";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  configToken: z.string().min(1),
  venueId: z.string().min(1),
  restaurantName: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  partySize: z.number().int().min(1).max(20),
  taskId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  // ─── 1. Authenticate ──────────────────────────────────────────────
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ─── 2. Validate body ─────────────────────────────────────────────
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // ─── 3. Load Resy credentials (via service client, RLS-bypassing) ─
  const svc = createSupabaseServiceClient();
  const credentials = await fetchResyCredentials(svc, user.id);
  if (!credentials) {
    return NextResponse.json(
      { error: "Resy credentials are not set. Add them in Settings first." },
      { status: 400 },
    );
  }

  // ─── 4. Open MCP session and book ─────────────────────────────────
  let booking;
  try {
    booking = await withResySession(
      {
        apifyToken: env.APIFY_API_TOKEN,
        supabase: svc,
        source: "agent",
        userId: user.id,
        // 30s keepalive: a confirmed booking is often followed by
        // a "show me my reservations" turn from the agent, so let
        // the warm actor absorb that without another cold start.
        keepaliveMs: 30_000,
      },
      credentials,
      async (resy) =>
        resy.book(input.configToken, {
          venueId: input.venueId,
          restaurantName: input.restaurantName,
        }),
    );
  } catch (err) {
    const message =
      err instanceof ResyMcpError
        ? err.kind === "invalid_credentials"
          ? "Resy login failed. Re-enter your credentials in Settings."
          : `Booking failed: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[bookings/confirm] booking failed", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // ─── 5. Persist reservation row ───────────────────────────────────
  const { data: reservation, error: insertErr } = await svc
    .from("reservations")
    .insert({
      user_id: user.id,
      task_id: input.taskId ?? null,
      platform: "resy",
      // platform_id stores the Resy `resy_token` — needed to cancel later.
      platform_id: booking.resyToken,
      restaurant_name: input.restaurantName,
      venue_id: input.venueId,
      date: input.date,
      time: input.time,
      party_size: input.partySize,
      status: "confirmed",
      booked_by: "agent",
      raw_data: booking.raw,
    })
    .select()
    .single();

  if (insertErr || !reservation) {
    console.error("[bookings/confirm] insert failed", insertErr);
    return NextResponse.json(
      {
        error:
          "Booking succeeded on Resy but persisting to our DB failed. Contact support.",
      },
      { status: 500 },
    );
  }

  // ─── 6. If this came from a monitoring task, mark it booked ──────
  if (input.taskId) {
    await svc
      .from("reservation_tasks")
      .update({ status: "booked", resolved_at: new Date().toISOString() })
      .eq("id", input.taskId)
      .eq("user_id", user.id);
  }

  // ─── 7. Audit trail ───────────────────────────────────────────────
  await svc.from("activity_log").insert({
    user_id: user.id,
    event_type: "booking_confirmed",
    description: `${input.restaurantName} booked for ${input.date} at ${input.time}`,
    metadata: {
      reservation_id: reservation.id,
      venue_id: input.venueId,
      party_size: input.partySize,
      source: "agent",
    },
  });

  return NextResponse.json({
    reservation: {
      id: reservation.id,
      restaurantName: input.restaurantName,
      date: input.date,
      time: input.time,
      partySize: input.partySize,
      resyToken: booking.resyToken,
    },
  });
}
