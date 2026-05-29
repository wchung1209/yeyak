/**
 * POST /api/admin/access-requests/:id/reject
 *
 * Admin-only. Marks the access request as rejected. No invite created.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const svc = createSupabaseServiceClient();

  const { data: request, error: loadErr } = await svc
    .from("access_requests")
    .select("id, email, status")
    .eq("id", params.id)
    .single();
  if (loadErr || !request) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (request.status !== "pending") {
    return NextResponse.json(
      { error: `Request already ${request.status}` },
      { status: 409 },
    );
  }

  const { error: updateErr } = await svc
    .from("access_requests")
    .update({
      status: "rejected",
      decided_by: user.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", request.id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await svc.from("activity_log").insert({
    user_id: user.id,
    event_type: "access_rejected",
    description: request.email,
    metadata: { access_request_id: request.id },
  });

  return NextResponse.json({ ok: true });
}
