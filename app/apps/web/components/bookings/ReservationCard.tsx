"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { Reservation } from "@yeyak/types";

export function ReservationCard({ reservation }: { reservation: Reservation }) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const upcoming = new Date(`${reservation.date}T${reservation.time}`) > new Date();

  async function cancel() {
    if (!confirm(`Cancel your reservation at ${reservation.restaurant_name}?`)) return;
    setCancelling(true);
    await fetch(`/api/reservations/${reservation.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-serif text-base">{reservation.restaurant_name}</h3>
          <p className="text-xs text-muted">
            {reservation.date} · {reservation.time.slice(0, 5)} · Party of {reservation.party_size}
          </p>
        </div>
        {reservation.status === "cancelled" ? (
          <Badge tone="neutral">Cancelled</Badge>
        ) : upcoming ? (
          <Badge tone="success">Confirmed</Badge>
        ) : (
          <Badge tone="neutral">Past</Badge>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted">Booked by {reservation.booked_by}</p>
      {reservation.status === "confirmed" && upcoming && (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" onClick={cancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        </div>
      )}
    </div>
  );
}
