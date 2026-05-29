/**
 * POST /api/access-requests — public endpoint.
 *
 * Anonymous prospective users submit name + email to request access to
 * Yeyak. The row lands in access_requests with status='pending'; admin
 * reviews via /admin/access-requests and approves to mint an invite.
 *
 * Dedupes against:
 *   - existing PENDING access_requests for the same email (idempotent)
 *   - existing PENDING invites for the same email (already invited)
 *   - existing ACCEPTED invites for the same email (already an account)
 *
 * Always returns 200 with a status discriminator so the UI shows a
 * consistent success message (this avoids leaking which emails are
 * already in the system).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const Body = z.object({
  email: z.string().email().max(254).transform((v) => v.trim()),
  first_name: z.string().min(1).max(80).transform((v) => v.trim()),
  last_name: z.string().min(1).max(80).transform((v) => v.trim()),
  display_name: z
    .string()
    .max(80)
    .optional()
    .transform((v) => (v ? v.trim() : v)),
});

type RequestStatus =
  | "submitted"
  | "already_pending"
  | "already_invited"
  | "already_account";

export async function POST(req: NextRequest) {
  let parsed;
  try {
    parsed = Body.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { email, first_name, last_name, display_name } = parsed.data;
  const emailLower = email.toLowerCase();
  const svc = createSupabaseServiceClient();

  // 1) Idempotent: pending request for same email already exists.
  const { data: pending } = await svc
    .from("access_requests")
    .select("id")
    .eq("status", "pending")
    .ilike("email", emailLower)
    .maybeSingle();
  if (pending) {
    return NextResponse.json({ ok: true, status: "already_pending" satisfies RequestStatus });
  }

  // 2) Pending or accepted invite already issued for this email.
  const { data: invite } = await svc
    .from("invites")
    .select("accepted, expires_at")
    .ilike("email", emailLower)
    .maybeSingle();
  if (invite) {
    if (invite.accepted) {
      return NextResponse.json({ ok: true, status: "already_account" satisfies RequestStatus });
    }
    if (new Date(invite.expires_at) > new Date()) {
      return NextResponse.json({ ok: true, status: "already_invited" satisfies RequestStatus });
    }
    // Expired invite — fall through and let the new request be created.
  }

  // 3) Create the request.
  const { data: created, error: insertErr } = await svc
    .from("access_requests")
    .insert({
      email,
      first_name,
      last_name,
      display_name: display_name || null,
    })
    .select("id")
    .single();

  if (insertErr || !created) {
    console.error("[access-requests] insert failed", insertErr);
    return NextResponse.json({ error: "Could not record request" }, { status: 500 });
  }

  await svc.from("activity_log").insert({
    user_id: null,
    event_type: "access_requested",
    description: email,
    metadata: { first_name, last_name, display_name: display_name ?? null },
  });

  return NextResponse.json({
    ok: true,
    status: "submitted" satisfies RequestStatus,
    id: created.id,
  });
}
