/**
 * Admin-only: GET /api/cost-events — paginated cost log.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false }> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (data?.role !== "admin") return { ok: false };
  return { ok: true, userId: user.id };
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const limit = Math.min(500, Number(req.nextUrl.searchParams.get("limit") ?? 100));
  const svc = createSupabaseServiceClient();
  const { data, error } = await svc
    .from("cost_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
