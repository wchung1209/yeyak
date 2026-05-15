/**
 * DELETE /api/reservations/:id — cancel via Resy, then flip DB status.
 *
 * If the user has Resy credentials and the reservation has a stored
 * `platform_id` (the Resy `resy_token`), we open an MCP session, call
 * `cancel`, then close. The DB row is updated regardless of Resy
 * success — if Resy fails we still flip our row to cancelled and log
 * the error so the user isn't stuck with a ghost reservation in the UI.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { withResySession, ResyMcpError, fetchResyCredentials } from "@yeyak/resy";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: res, error: fetchErr } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", params.id)
    .single();
  if (fetchErr || !res) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const svc = createSupabaseServiceClient();
  const credentials = await fetchResyCredentials(svc, user.id);

  // Best-effort cancel on Resy. We don't fail the whole request if Resy
  // errors — the user still gets their DB record cleared.
  if (res.platform_id && credentials) {
    try {
      await withResySession(
        {
          apifyToken: env.APIFY_API_TOKEN,
          supabase: svc,
          source: "agent",
          userId: user.id,
        },
        credentials,
        async (resy) => resy.cancel(res.platform_id),
      );
    } catch (err) {
      const detail =
        err instanceof ResyMcpError ? `${err.kind}: ${err.message}` : err;
      console.error("[reservations] Resy cancel failed", detail);
    }
  }

  const { error } = await supabase
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await svc.from("activity_log").insert({
    user_id: user.id,
    event_type: "booking_cancelled",
    description: `${res.restaurant_name} cancelled`,
    metadata: { reservation_id: res.id },
  });

  return NextResponse.json({ cancelled: true });
}
