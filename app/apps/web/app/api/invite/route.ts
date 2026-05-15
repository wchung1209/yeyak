/**
 * Admin-only: POST /api/invite { email } — create invite + send email.
 * Also: GET /api/invite?token=... — public, fetch invite email by token
 * (used by the /invite/[token] accept page).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { sendEmail } from "@/lib/notifications/send";
import { env } from "@/lib/env";

const InviteBody = z.object({ email: z.string().email() });

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });

  const svc = createSupabaseServiceClient();
  const { data, error } = await svc
    .from("invites")
    .select("email, expires_at, accepted")
    .eq("token", token)
    .single();
  if (error || !data || data.accepted || new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ error: "invalid or expired" }, { status: 404 });
  }
  return NextResponse.json({ email: data.email });
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = InviteBody.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const svc = createSupabaseServiceClient();
  const { data, error } = await svc
    .from("invites")
    .insert({ email: parsed.data.email, invited_by: user.id })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const link = `${env.APP_URL}/invite/${data.token}`;
  try {
    await sendEmail({
      to: parsed.data.email,
      subject: "You're invited to Yeyak",
      html: `<p>You've been invited to Yeyak.</p><p><a href="${link}">Accept your invite</a></p>
             <p>This link expires in 7 days.</p>`,
    });
  } catch (err) {
    console.error("[invite] email send failed", err);
  }

  await svc.from("activity_log").insert({
    user_id: user.id,
    event_type: "invite_sent",
    description: parsed.data.email,
  });

  return NextResponse.json({ id: data.id, token: data.token });
}
