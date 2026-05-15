import type { ActivityEvent } from "@yeyak/types";

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted">Nothing yet.</p>;
  }
  return (
    <ul className="divide-y divide-ink/5 overflow-hidden rounded-xl border border-ink/10 bg-white text-sm">
      {events.map((ev) => (
        <li key={ev.id} className="flex items-start justify-between gap-4 px-3 py-2">
          <div>
            <p className="font-medium">{ev.event_type.replace(/_/g, " ")}</p>
            {ev.description && <p className="text-xs text-muted">{ev.description}</p>}
          </div>
          <time className="text-xs text-muted">{new Date(ev.created_at).toLocaleString()}</time>
        </li>
      ))}
    </ul>
  );
}
