/**
 * GET /api/admin/access-requests?status=pending|approved|rejected|all
 *
 * Admin-only. Returns access requests ordered newest first. Default
 * filter is `pending` so the admin sees the inbox by default.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

const StatusFilter = z.enum(["pending", "approved", "rejected", "all"]).default("pending");

export async function GET(req: NextRequest) {
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

  const filter = StatusFilter.safeParse(req.nextUrl.searchParams.get("status") ?? undefined);
  if (!filter.success) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const svc = createSupabaseServiceClient();
  let query = svc
    .from("access_requests")
    .select("id, email, first_name, last_name, display_name, status, created_at, decided_at, decided_by, invite_id")
    .order("created_at", { ascending: false })
    .limit(200);

  if (filter.data !== "all") {
    query = query.eq("status", filter.data);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requests: data ?? [] });
}
