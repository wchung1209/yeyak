/**
 * POST /api/invite/accept { token }
 *
 * Called after the signed-in user completes the signUp flow. Marks the
 * invite as accepted. Any auth-side validation happens in middleware.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

const Body = z.object({ token: z.string().min(1) });

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const svc = createSupabaseServiceClient();
  const { data: invite } = await svc
    .from("invites")
    .select("*")
    .eq("token", parsed.data.token)
    .single();

  if (!invite || invite.accepted || new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "invalid or expired" }, { status: 400 });
  }
  if (invite.email.toLowerCase() !== user.email?.toLowerCase()) {
    return NextResponse.json({ error: "email mismatch" }, { status: 400 });
  }

  await svc.from("invites").update({ accepted: true }).eq("id", invite.id);
  return NextResponse.json({ accepted: true });
}
