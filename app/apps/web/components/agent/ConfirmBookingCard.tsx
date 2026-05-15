"use client";

import { Button } from "@/components/ui/Button";
import type { ChatConfirmBookingMessage, PendingBooking } from "./types";

export type { PendingBooking };

/**
 * Renders a confirm-booking card for a pending reservation. Visual state
 * depends on `message.status`:
 *   - awaiting:   two buttons (Not now / Confirm & book)
 *   - confirming: disabled buttons, "Booking…" copy
 *   - confirmed:  success state with confirmation number
 *   - declined:   muted, "Dismissed" badge
 *   - error:      error copy + retry
 */
export function ConfirmBookingCard({
  message,
  onConfirm,
  onDecline,
}: {
  message: ChatConfirmBookingMessage;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const { pending, status } = message;
  const disabled = status !== "awaiting" && status !== "error";

  return (
    <div className="rounded-xl border-2 border-brass bg-white p-4">
      <p className="mb-1 text-xs uppercase tracking-wide text-brass">
        {status === "confirmed"
          ? "Booked"
          : status === "declined"
            ? "Dismissed"
            : status === "error"
              ? "Booking failed"
              : "Please confirm"}
      </p>
      <h3 className="font-serif text-lg">{pending.restaurantName}</h3>
      <dl className="mt-3 space-y-1 text-sm">
        <Row label="Date" value={pending.date} />
        <Row label="Time" value={pending.time} />
        <Row label="Party" value={`${pending.partySize}`} />
        {status === "confirmed" && message.confirmationNumber ? (
          <Row label="Confirmation" value={message.confirmationNumber} />
        ) : null}
      </dl>

      {status === "error" && message.errorMessage ? (
        <p className="mt-3 text-sm text-red-600">{message.errorMessage}</p>
      ) : null}

      {status === "confirmed" || status === "declined" ? null : (
        <div className="mt-4 flex gap-2">
          <Button onClick={onDecline} variant="ghost" disabled={disabled} className="flex-1">
            Not now
          </Button>
          <Button onClick={onConfirm} disabled={disabled} className="flex-1">
            {status === "confirming"
              ? "Booking…"
              : status === "error"
                ? "Try again"
                : "Confirm & book"}
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
