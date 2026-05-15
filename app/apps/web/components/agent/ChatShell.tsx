"use client";

import { ChatWindow } from "./ChatWindow";
import { ChatInput } from "./ChatInput";
import { EntryOptions } from "./EntryOptions";
import { useChat } from "@/lib/chat/ChatContext";

/**
 * Chat surface. Pure consumer of <ChatProvider> — all state and the
 * streaming /api/agent fetch live in the layout-level provider so they
 * persist across navigation.
 */
export function ChatShell() {
  const {
    messages,
    busy,
    send,
    resetChat,
    confirmBooking,
    declineBooking,
    pickSlot,
    watchVenue,
  } = useChat();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="px-5 pb-3 pt-5">
        <button
          type="button"
          onClick={resetChat}
          className="block text-left transition hover:opacity-70"
          aria-label="Start a new conversation"
          title="Start a new conversation"
        >
          <h1 className="font-serif text-2xl">Yeyak</h1>
          <p className="text-xs text-muted">Your reservationist is at your service.</p>
        </button>
      </header>
      {messages.length <= 1 && <EntryOptions onSeed={send} />}
      <ChatWindow
        messages={messages}
        busy={busy}
        onConfirmBooking={confirmBooking}
        onDeclineBooking={declineBooking}
        onPickSlot={pickSlot}
        onWatchVenue={watchVenue}
        onPickSuggestion={send}
      />
      <ChatInput onSend={send} disabled={busy} />
    </div>
  );
}
