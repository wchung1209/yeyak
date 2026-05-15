import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/admin/StatCard";
import { CostTable } from "@/components/admin/CostTable";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import type { ActivityEvent, CostEvent } from "@yeyak/types";

export const dynamic = "force-dynamic";

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default async function AdminDashboardPage() {
  // Service role — server-only, bypasses RLS for aggregated reads.
  const svc = createSupabaseServiceClient();

  const [
    { data: costs },
    { data: activity },
  ] = await Promise.all([
    svc.from("cost_events").select("*").order("created_at", { ascending: false }).limit(500),
    svc.from("activity_log").select("*").order("created_at", { ascending: false }).limit(50),
  ]);

  const allCosts = (costs ?? []) as CostEvent[];
  const today = startOfDay();
  const month = startOfMonth();

  const sum = (rows: CostEvent[]) => rows.reduce((a, b) => a + Number(b.cost_usd), 0);
  const totalAll = sum(allCosts);
  const totalMonth = sum(allCosts.filter((c) => c.created_at >= month));
  const totalToday = sum(allCosts.filter((c) => c.created_at >= today));

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Total spend" value={`$${totalAll.toFixed(2)}`} />
        <StatCard label="This month" value={`$${totalMonth.toFixed(2)}`} />
        <StatCard label="Today" value={`$${totalToday.toFixed(2)}`} />
      </section>

      <section>
        <h2 className="mb-3 font-serif text-xl">Cost breakdown</h2>
        <CostTable events={allCosts} />
      </section>

      <section>
        <h2 className="mb-3 font-serif text-xl">Recent activity</h2>
        <ActivityFeed events={(activity ?? []) as ActivityEvent[]} />
      </section>
    </div>
  );
}
