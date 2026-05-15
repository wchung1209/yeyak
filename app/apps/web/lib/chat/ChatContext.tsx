"use client";

/**
 * Chat state + actions, lifted out of `ChatShell` so they live in the
 * `(app)/layout.tsx` provider. Why: the (app) layout is the only thing
 * that doesn't unmount when the user navigates between /, /settings,
 * /bookings. Owning state here means:
 *
 *   1. An in-flight `/api/agent` fetch keeps streaming even if the user
 *      switches tabs — when they return, the conversation is already
 *      caught up.
 *   2. ChatShell becomes a pure renderer that consumes via `useChat()`.
 *
 * Persistence (sessionStorage) lives here too. The shape and behavior
 * mirror the previous in-component implementation; this is a hoist, not
 * a redesign.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ChatConfirmBookingMessage,
  ChatMessage,
  ChatSuggestionsMessage,
  ChatVenueListMessage,
  PendingBooking,
  StreamEvent,
} from "@/components/agent/types";
import {
  clearChatState,
  loadChatState,
  saveChatState,
  type ChatTranscriptEntry,
} from "@/lib/chat/storage";
import type { ResySlot, ResyVenue } from "@yeyak/types";

// ─── Helpers ──────────────────────────────────────────────────────────

function welcomeMessage(displayName: string | null): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    kind: "text",
    text: displayName
      ? `Welcome back, ${displayName}. What would you like to book tonight?`
      : "Welcome to Yeyak. What would you like to book tonight?",
  };
}

/**
 * Repair states that only make sense during an active fetch. If the user
 * navigates mid-turn (or closes/reopens the tab), a `tool_call` placeholder
 * may be persisted with `status: "running"` — but the fetch is gone, so
 * the spinner would never resolve. Mark stuck running states as errored.
 */
function sanitizeRehydratedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (m.kind === "tool_call" && m.status === "running") {
      return { ...m, status: "error" as const };
    }
    if (m.kind === "confirm_booking" && m.status === "confirming") {
      return { ...m, status: "awaiting" as const };
    }
    return m;
  });
}

interface PendingConfirmationOutput {
  status: "pending_confirmation";
  configToken: string;
  venueId: string;
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
  taskId: string | null;
}

function isPendingConfirmation(output: unknown): output is PendingConfirmationOutput {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as { status?: unknown }).status === "pending_confirmation"
  );
}

function isDuplicateError(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as { error?: unknown }).error === "duplicate_check_availability"
  );
}

/**
 * Drop the most recent running tool_call placeholder for `toolName`
 * without inserting a replacement. Used when the executor short-
 * circuits a redundant call and we want the chat to look as if the
 * tool was never invoked.
 */
function removeRunningPlaceholder(
  messages: ChatMessage[],
  toolName: string,
): ChatMessage[] {
  const copy = [...messages];
  for (let i = copy.length - 1; i >= 0; i--) {
    const msg = copy[i];
    if (
      msg &&
      msg.kind === "tool_call" &&
      msg.status === "running" &&
      msg.toolName === toolName
    ) {
      copy.splice(i, 1);
      return copy;
    }
  }
  return copy;
}

function asVenueArray(toolName: string, output: unknown): ResyVenue[] | null {
  if (toolName === "search_restaurants" && Array.isArray(output)) {
    return output as ResyVenue[];
  }
  if (
    toolName === "check_availability" &&
    typeof output === "object" &&
    output !== null &&
    "venueId" in output &&
    "slots" in output
  ) {
    return [output as ResyVenue];
  }
  return null;
}

function prettyTime(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = Number.parseInt(hStr ?? "0", 10);
  const m = mStr ?? "00";
  const meridiem = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${meridiem}`;
}

function replaceRunningPlaceholder(
  messages: ChatMessage[],
  toolName: string,
  replacement: ChatMessage,
): ChatMessage[] {
  const copy = [...messages];
  for (let i = copy.length - 1; i >= 0; i--) {
    const msg = copy[i];
    if (
      msg &&
      msg.kind === "tool_call" &&
      msg.status === "running" &&
      msg.toolName === toolName
    ) {
      copy.splice(i, 1, replacement);
      return copy;
    }
  }
  return [...copy, replacement];
}

// ─── Context shape ────────────────────────────────────────────────────

export interface ChatContextValue {
  messages: ChatMessage[];
  busy: boolean;
  send: (text: string) => void;
  resetChat: () => void;
  confirmBooking: (messageId: string, pending: PendingBooking) => Promise<void>;
  declineBooking: (messageId: string, pending: PendingBooking) => void;
  pickSlot: (venue: ResyVenue, slot: ResySlot) => void;
  watchVenue: (venue: ResyVenue) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChat must be used inside a <ChatProvider>");
  }
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────

export function ChatProvider({
  displayName,
  children,
}: {
  displayName: string | null;
  children: ReactNode;
}) {
  // One-shot lazy init: read sessionStorage once. After this, initialRef
  // is the source of truth for the seed sessionId/messages/transcript.
  const initialRef = useRef<{
    sessionId: string;
    messages: ChatMessage[];
    transcript: ChatTranscriptEntry[];
  } | null>(null);
  if (initialRef.current === null) {
    const stored = loadChatState();
    initialRef.current = stored
      ? {
          sessionId: stored.sessionId,
          messages: sanitizeRehydratedMessages(stored.messages),
          transcript: stored.transcript,
        }
      : {
          sessionId: crypto.randomUUID(),
          messages: [welcomeMessage(displayName)],
          transcript: [],
        };
  }

  const [sessionId, setSessionId] = useState(initialRef.current.sessionId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialRef.current.messages);
  const [busy, setBusy] = useState(false);

  const transcriptRef = useRef<ChatTranscriptEntry[]>(initialRef.current.transcript);
  // Bumped when transcriptRef changes via final_messages, so the save
  // effect picks up the new transcript even when `messages` itself
  // hasn't changed in the same render pass.
  const [transcriptVersion, setTranscriptVersion] = useState(0);
  const busyRef = useRef(false);
  const queueRef = useRef<string[]>([]);

  // Persist on every messages or transcript change.
  useEffect(() => {
    saveChatState({
      v: 1,
      sessionId,
      messages,
      transcript: transcriptRef.current,
    });
  }, [messages, sessionId, transcriptVersion]);

  const resetChat = useCallback(() => {
    clearChatState();
    transcriptRef.current = [];
    queueRef.current = [];
    setSessionId(crypto.randomUUID());
    setMessages([welcomeMessage(displayName)]);
    setTranscriptVersion((v) => v + 1);
  }, [displayName]);

  const send = useCallback(
    async (text: string) => {
      queueRef.current.push(text);
      if (busyRef.current) return;

      busyRef.current = true;
      setBusy(true);
      try {
        while (queueRef.current.length > 0) {
          const next = queueRef.current.shift();
          if (!next) break;
          await runTurn(next);
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }

      async function runTurn(text: string) {
        const userMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          kind: "text",
          text,
        };
        setMessages((m) => [...m, userMsg]);
        transcriptRef.current = [
          ...transcriptRef.current,
          { role: "user", content: text },
        ];

        try {
          const res = await fetch("/api/agent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messages: transcriptRef.current,
              sessionId,
            }),
          });
          if (!res.ok || !res.body) throw new Error("Agent request failed.");

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf("\n\n")) !== -1) {
              const raw = buffer.slice(0, idx).trim();
              buffer = buffer.slice(idx + 2);
              if (!raw.startsWith("data:")) continue;
              const payload = raw.slice(5).trim();
              if (!payload) continue;
              handleEvent(JSON.parse(payload) as StreamEvent);
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setMessages((m) => [
            ...m,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              kind: "text",
              text: `I ran into a problem: ${message}`,
            },
          ]);
        }
      }

      function handleEvent(ev: StreamEvent) {
        if (ev.type === "text") {
          setMessages((m) => [
            ...m,
            { id: crypto.randomUUID(), role: "assistant", kind: "text", text: ev.text },
          ]);
        } else if (ev.type === "tool_use") {
          if (ev.name === "suggest_replies") {
            const input = ev.input as { suggestions?: unknown };
            const suggestions = Array.isArray(input?.suggestions)
              ? (input.suggestions.filter(
                  (s) => typeof s === "string" && s.length > 0,
                ) as string[])
              : [];
            if (suggestions.length === 0) return;
            const msg: ChatSuggestionsMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              kind: "suggestions",
              suggestions,
            };
            setMessages((m) => [...m, msg]);
            return;
          }
          setMessages((m) => [
            ...m,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              kind: "tool_call",
              toolName: ev.name,
              status: "running",
            },
          ]);
        } else if (ev.type === "tool_result") {
          // Hard-dedup short-circuit. The executor returns
          // `duplicate_check_availability` when the agent re-calls
          // check_availability for the same venue/date/party in this
          // session. Pull the running placeholder out silently so the
          // user doesn't see a redundant "Checking availability…"
          // followed by an empty result.
          if (
            ev.name === "check_availability" &&
            isDuplicateError(ev.output)
          ) {
            setMessages((m) =>
              removeRunningPlaceholder(m, "check_availability"),
            );
            return;
          }

          if (ev.name === "book_reservation" && isPendingConfirmation(ev.output)) {
            const o = ev.output;
            const pending: PendingBooking = {
              configToken: o.configToken,
              venueId: o.venueId,
              restaurantName: o.restaurantName,
              date: o.date,
              time: o.time,
              partySize: o.partySize,
              ...(o.taskId ? { taskId: o.taskId } : {}),
            };
            const confirmMsg: ChatConfirmBookingMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              kind: "confirm_booking",
              pending,
              status: "awaiting",
            };
            setMessages((m) => replaceRunningPlaceholder(m, "book_reservation", confirmMsg));
            return;
          }

          const venues = asVenueArray(ev.name, ev.output);
          if (venues && venues.length > 0) {
            const venueMsg: ChatVenueListMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              kind: "venue_list",
              venues,
            };
            setMessages((m) => replaceRunningPlaceholder(m, ev.name, venueMsg));
            return;
          }

          setMessages((m) => {
            const copy = [...m];
            for (let i = copy.length - 1; i >= 0; i--) {
              const msg = copy[i];
              if (
                msg &&
                msg.kind === "tool_call" &&
                msg.status === "running" &&
                msg.toolName === ev.name
              ) {
                copy[i] = { ...msg, status: "done", output: ev.output };
                break;
              }
            }
            return copy;
          });
        } else if (ev.type === "error") {
          setMessages((m) => [
            ...m,
            { id: crypto.randomUUID(), role: "assistant", kind: "text", text: ev.error },
          ]);
        } else if (ev.type === "final_messages") {
          // Replace the local transcript with the server's full
          // Anthropic-format history. This is what gives the agent
          // memory of prior tool_use / tool_result blocks across
          // turns; without it, every POST is a fresh slate to the LLM.
          transcriptRef.current = ev.messages as ChatTranscriptEntry[];
          setTranscriptVersion((v) => v + 1);
        }
      }
    },
    [sessionId],
  );

  const patchConfirmMessage = useCallback(
    (id: string, patch: Partial<ChatConfirmBookingMessage>) => {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === id && msg.kind === "confirm_booking" ? { ...msg, ...patch } : msg,
        ),
      );
    },
    [],
  );

  const confirmBooking = useCallback(
    async (messageId: string, pending: PendingBooking) => {
      patchConfirmMessage(messageId, { status: "confirming", errorMessage: undefined });
      try {
        const res = await fetch("/api/bookings/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pending),
        });
        const payload = (await res.json().catch(() => null)) as
          | {
              reservation?: {
                id: string;
                restaurantName: string;
                date: string;
                time: string;
                partySize: number;
                confirmationNumber: string | null;
              };
              error?: string;
            }
          | null;

        if (!res.ok || !payload?.reservation) {
          const errorMessage = payload?.error ?? `Booking failed (HTTP ${res.status}).`;
          patchConfirmMessage(messageId, { status: "error", errorMessage });
          return;
        }

        patchConfirmMessage(messageId, {
          status: "confirmed",
          confirmationNumber: payload.reservation.confirmationNumber ?? null,
          reservationId: payload.reservation.id,
        });

        void send(
          `I confirmed the booking at ${pending.restaurantName} on ${pending.date} at ${pending.time} for ${pending.partySize}.`,
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        patchConfirmMessage(messageId, { status: "error", errorMessage });
      }
    },
    [patchConfirmMessage, send],
  );

  const declineBooking = useCallback(
    (messageId: string, pending: PendingBooking) => {
      patchConfirmMessage(messageId, { status: "declined" });
      void send(`Don't book ${pending.restaurantName} for now.`);
    },
    [patchConfirmMessage, send],
  );

  const pickSlot = useCallback(
    (venue: ResyVenue, slot: ResySlot) => {
      void send(`Book ${venue.name} on ${slot.date} at ${prettyTime(slot.time)}.`);
    },
    [send],
  );

  const watchVenue = useCallback(
    (venue: ResyVenue) => {
      void send(`Set up a watch for ${venue.name}.`);
    },
    [send],
  );

  const value: ChatContextValue = {
    messages,
    busy,
    send: send as (text: string) => void,
    resetChat,
    confirmBooking,
    declineBooking,
    pickSlot,
    watchVenue,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
