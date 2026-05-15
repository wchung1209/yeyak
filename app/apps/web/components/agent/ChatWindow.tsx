"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { ConfirmBookingCard } from "./ConfirmBookingCard";
import { RestaurantCard } from "./RestaurantCard";
import { SuggestionChips } from "./SuggestionChips";
import { ThinkingIndicator } from "./ThinkingIndicator";
import type { ChatMessage, PendingBooking } from "./types";
import type { ResySlot, ResyVenue } from "@yeyak/types";

export function ChatWindow({
  messages,
  busy,
  onConfirmBooking,
  onDeclineBooking,
  onPickSlot,
  onWatchVenue,
  onPickSuggestion,
}: {
  messages: ChatMessage[];
  busy: boolean;
  onConfirmBooking: (messageId: string, pending: PendingBooking) => void;
  onDeclineBooking: (messageId: string, pending: PendingBooking) => void;
  onPickSlot: (venue: ResyVenue, slot: ResySlot) => void;
  onWatchVenue: (venue: ResyVenue) => void;
  onPickSuggestion: (text: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy]);

  return (
    <div className="chat-scroll flex-1 space-y-3 overflow-y-auto px-5 py-4">
      {messages.map((m) => {
        if (m.kind === "text") return <MessageBubble key={m.id} message={m} />;
        if (m.kind === "tool_call") return <ToolCallDisplay key={m.id} message={m} />;
        if (m.kind === "venue_list") {
          return (
            <div key={m.id} className="space-y-2">
              {m.venues.map((venue) => (
                <RestaurantCard
                  key={venue.venueId}
                  venue={venue}
                  onPickSlot={onPickSlot}
                  onWatch={onWatchVenue}
                />
              ))}
            </div>
          );
        }
        if (m.kind === "suggestions") {
          return (
            <SuggestionChips
              key={m.id}
              suggestions={m.suggestions}
              onPick={onPickSuggestion}
            />
          );
        }
        return (
          <ConfirmBookingCard
            key={m.id}
            message={m}
            onConfirm={() => onConfirmBooking(m.id, m.pending)}
            onDecline={() => onDeclineBooking(m.id, m.pending)}
          />
        );
      })}
      {busy && <ThinkingIndicator />}
      <div ref={endRef} />
    </div>
  );
}
