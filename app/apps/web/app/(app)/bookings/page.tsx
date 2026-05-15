import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TaskCard } from "@/components/bookings/TaskCard";
import { ReservationCard } from "@/components/bookings/ReservationCard";
import type { ReservationTask, Reservation } from "@yeyak/types";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const supabase = createSupabaseServerClient();

  const [{ data: tasks }, { data: reservations }] = await Promise.all([
    supabase
      .from("reservation_tasks")
      .select("*")
      .in("status", ["active"])
      .order("target_date", { ascending: true }),
    supabase
      .from("reservations")
      .select("*")
      .order("date", { ascending: true }),
  ]);

  return (
    <div className="space-y-8 px-5 pt-6">
      <header>
        <h1 className="font-serif text-2xl">My bookings</h1>
        <p className="text-sm text-muted">Active monitoring jobs and confirmed tables.</p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
          Active tasks
        </h2>
        {tasks && tasks.length > 0 ? (
          <div className="space-y-3">
            {(tasks as ReservationTask[]).map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No active tasks. Start a reservation in chat.</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
          Confirmed reservations
        </h2>
        {reservations && reservations.length > 0 ? (
          <div className="space-y-3">
            {(reservations as Reservation[]).map((r) => (
              <ReservationCard key={r.id} reservation={r} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No reservations yet.</p>
        )}
      </section>
    </div>
  );
}
