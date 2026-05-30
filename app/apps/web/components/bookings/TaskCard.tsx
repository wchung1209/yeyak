"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { ReservationTask } from "@yeyak/types";

/**
 * Format the watch window. Single-day shows "Jun 1"; date-range shows
 * "Jun 1 – Jun 4" so multi-day monitors render the whole span (was
 * previously only showing target_date — task #15).
 */
function formatWatchWindow(start: string, end: string | null): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const startLabel = new Date(`${start}T00:00:00`).toLocaleDateString(undefined, opts);
  if (!end || end === start) return startLabel;
  const endLabel = new Date(`${end}T00:00:00`).toLocaleDateString(undefined, opts);
  return `${startLabel} – ${endLabel}`;
}

export function TaskCard({ task }: { task: ReservationTask }) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);

  async function cancel() {
    if (!confirm("Cancel this reservation watch?")) return;
    setCancelling(true);
    await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-serif text-base">{task.restaurant_name}</h3>
          <p className="text-xs text-muted">
            {formatWatchWindow(task.target_date, task.target_date_end)} · {task.time_start.slice(0, 5)}–{task.time_end.slice(0, 5)} · Party of {task.party_size}
          </p>
        </div>
        <Badge tone="info">Watching</Badge>
      </div>
      {task.last_checked_at && (
        <p className="mt-2 text-[11px] text-muted">
          last checked {new Date(task.last_checked_at).toLocaleString()}
        </p>
      )}
      <div className="mt-3 flex justify-end">
        <Button variant="ghost" onClick={cancel} disabled={cancelling}>
          {cancelling ? "Cancelling…" : "Cancel watch"}
        </Button>
      </div>
    </div>
  );
}
