/**
 * POST   /api/tasks  — create a reservation_task (RLS ensures user_id = auth.uid)
 * GET    /api/tasks  — list own tasks
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CreateBody = z.object({
  venue_id: z.string(),
  restaurant_name: z.string(),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time_start: z.string(),
  time_end: z.string(),
  party_size: z.number().int().min(1).max(20),
  notify_only: z.boolean().optional(),
});

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("reservation_tasks")
    .select("*")
    .order("target_date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = CreateBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { data, error } = await supabase
    .from("reservation_tasks")
    .insert({ ...parsed.data, user_id: user.id })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
