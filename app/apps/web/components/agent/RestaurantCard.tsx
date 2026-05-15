"use client";

import { useState } from "react";
import type { ResyVenue, ResySlot } from "@yeyak/types";

const COLLAPSED_SLOT_COUNT = 6;

/**
 * Format an HH:MM 24h string as "7:00 PM" / "12:30 PM".
 */
function formatTime(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = Number.parseInt(hStr ?? "0", 10);
  const m = mStr ?? "00";
  const meridiem = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${meridiem}`;
}

/**
 * Bias the visible slot list toward dinner times (>= 17:00) when there
 * are enough; fall back to the full list otherwise. Doesn't truncate —
 * the caller decides whether to show a collapsed window.
 */
function dinnerBiased(slots: ResySlot[]): ResySlot[] {
  const evening = slots.filter((s) => s.time >= "17:00");
  return evening.length >= 3 ? evening : slots;
}

export function RestaurantCard({
  venue,
  onPickSlot,
  onWatch,
}: {
  venue: ResyVenue;
  onPickSlot: (venue: ResyVenue, slot: ResySlot) => void;
  onWatch: (venue: ResyVenue) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const cuisineLabel = venue.cuisine.join(", ");
  const tagline = [cuisineLabel, venue.neighborhood].filter(Boolean).join(" · ");
  const orderedSlots = dinnerBiased(venue.slots);
  const visibleSlots = expanded
    ? orderedSlots
    : orderedSlots.slice(0, COLLAPSED_SLOT_COUNT);
  const hiddenCount = orderedSlots.length - visibleSlots.length;

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-serif text-base">{venue.name}</h3>
          {tagline && <p className="truncate text-xs text-muted">{tagline}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted">
          {venue.rating > 0 && (
            <span aria-label={`Rated ${venue.rating.toFixed(1)} out of 5`}>
              ★ {venue.rating.toFixed(1)}
            </span>
          )}
          {venue.priceRange > 0 && <span>{"$".repeat(venue.priceRange)}</span>}
        </div>
      </div>

      {orderedSlots.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {visibleSlots.map((slot) => (
            <button
              key={slot.configToken}
              onClick={() => onPickSlot(venue, slot)}
              className="rounded-md border border-ink/15 px-2 py-1 text-xs text-ink transition hover:border-brass hover:bg-brass/10"
              title={slot.type}
            >
              {formatTime(slot.time)}
            </button>
          ))}
          {hiddenCount > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="rounded-md px-2 py-1 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
              aria-expanded={expanded}
            >
              +{hiddenCount} more
            </button>
          )}
          {expanded && orderedSlots.length > COLLAPSED_SLOT_COUNT && (
            <button
              onClick={() => setExpanded(false)}
              className="rounded-md px-2 py-1 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
              aria-expanded={expanded}
            >
              Show less
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={() => onWatch(venue)}
          className="mt-3 w-full rounded-md border border-ink/15 py-2 text-xs text-muted hover:border-brass hover:text-ink"
        >
          No availability — watch this venue?
        </button>
      )}
    </div>
  );
}
