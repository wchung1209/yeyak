import type { CostEvent } from "@yeyak/types";

export function CostTable({ events }: { events: CostEvent[] }) {
  const groups = events.reduce<Record<string, { count: number; total: number }>>((acc, ev) => {
    const key = `${ev.source}:${ev.action}`;
    if (!acc[key]) acc[key] = { count: 0, total: 0 };
    acc[key].count += 1;
    acc[key].total += Number(ev.cost_usd);
    return acc;
  }, {});

  return (
    <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-ink/5 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">Action</th>
            <th className="px-3 py-2 text-right">Count</th>
            <th className="px-3 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/5">
          {Object.entries(groups).map(([key, { count, total }]) => {
            const [source, action] = key.split(":");
            return (
              <tr key={key}>
                <td className="px-3 py-2">{source}</td>
                <td className="px-3 py-2">{action}</td>
                <td className="px-3 py-2 text-right">{count}</td>
                <td className="px-3 py-2 text-right">${total.toFixed(2)}</td>
              </tr>
            );
          })}
          {Object.keys(groups).length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-center text-muted">
                No cost events yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
