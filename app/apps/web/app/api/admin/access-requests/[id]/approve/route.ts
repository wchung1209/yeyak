/**
 * POST /api/admin/access-requests/:id/approve
 *
 * Admin-only. Marks the access request as approved, ensures an invite
 * row exists for the email (creates one or refreshes an expired one),
 * links the access_request to the invite, and returns the invite URL
 * for the admin to share with the user manually (since auto-email is
 * deferred until Resend lands — see task #45).
 */
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

const INVITE_TTL_DAYS = 7;

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

  // Load the access request and gate on status.
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

  // Find or create the invite for this email.
  const newExpiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { data: existing } = await svc
    .from("invites")
    .select("id, token, accepted")
    .ilike("email", request.email)
    .maybeSingle();

  let inviteId: string;
  let inviteToken: string;

  if (existing?.accepted) {
    return NextResponse.json(
      { error: "An account already exists for this email." },
      { status: 409 },
    );
  }

  if (existing) {
    // Refresh expiry; keep the existing token so any previously shared
    // URL remains valid for the new window.
    const { error: updateErr } = await svc
      .from("invites")
      .update({ expires_at: newExpiresAt.toISOString(), invited_by: user.id })
      .eq("id", existing.id);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
    inviteId = existing.id;
    inviteToken = existing.token;
  } else {
    const { data: created, error: insertErr } = await svc
      .from("invites")
      .insert({ email: request.email, invited_by: user.id })
      .select("id, token")
      .single();
    if (insertErr || !created) {
      return NextResponse.json(
        { error: insertErr?.message ?? "Could not create invite" },
        { status: 500 },
      );
    }
    inviteId = created.id;
    inviteToken = created.token;
  }

  // Mark the request approved + link to the invite.
  const { error: requestUpdateErr } = await svc
    .from("access_requests")
    .update({
      status: "approved",
      decided_by: user.id,
      decided_at: new Date().toISOString(),
      invite_id: inviteId,
    })
    .eq("id", request.id);
  if (requestUpdateErr) {
    return NextResponse.json({ error: requestUpdateErr.message }, { status: 500 });
  }

  await svc.from("activity_log").insert({
    user_id: user.id,
    event_type: "access_approved",
    description: request.email,
    metadata: { access_request_id: request.id, invite_id: inviteId },
  });

  const inviteUrl = `${env.APP_URL}/invite/${inviteToken}`;

  return NextResponse.json({
    ok: true,
    invite_url: inviteUrl,
    invite_id: inviteId,
    expires_at: newExpiresAt.toISOString(),
  });
}
