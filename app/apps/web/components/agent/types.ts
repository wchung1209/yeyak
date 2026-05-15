/**
 * Client-side chat state types. Decoupled from the Anthropic SDK shapes
 * so the UI doesn't depend on SDK versions directly.
 */
import type { ResyVenue } from "@yeyak/types";

export type ChatRole = "user" | "assistant";

export interface ChatTextMessage {
  id: string;
  role: ChatRole;
  kind: "text";
  text: string;
}

export interface ChatToolCallMessage {
  id: string;
  role: "assistant";
  kind: "tool_call";
  toolName: string;
  status: "running" | "done" | "error";
  /** Arbitrary tool output for rendering cards (e.g. restaurant list) */
  output?: unknown;
}

/** Details of a booking the user is being asked to approve. */
export interface PendingBooking {
  configToken: string;
  venueId: string;
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
  taskId?: string;
}

/**
 * A booking awaiting user confirmation. Rendered as a ConfirmBookingCard.
 * Moves through: awaiting → confirming → confirmed | declined | error.
 */
export interface ChatConfirmBookingMessage {
  id: string;
  role: "assistant";
  kind: "confirm_booking";
  pending: PendingBooking;
  status: "awaiting" | "confirming" | "confirmed" | "declined" | "error";
  errorMessage?: string;
  confirmationNumber?: string | null;
  reservationId?: string;
}

/** Inline list of restaurant cards rendered from search/check_availability. */
export interface ChatVenueListMessage {
  id: string;
  role: "assistant";
  kind: "venue_list";
  venues: ResyVenue[];
}

/** Quick-reply suggestion chips emitted by the agent's suggest_replies tool. */
export interface ChatSuggestionsMessage {
  id: string;
  role: "assistant";
  kind: "suggestions";
  suggestions: string[];
}

export type ChatMessage =
  | ChatTextMessage
  | ChatToolCallMessage
  | ChatConfirmBookingMessage
  | ChatVenueListMessage
  | ChatSuggestionsMessage;

export interface StreamEventText {
  type: "text";
  text: string;
}
export interface StreamEventToolUse {
  type: "tool_use";
  name: string;
  input: unknown;
}
export interface StreamEventToolResult {
  type: "tool_result";
  name: string;
  output: unknown;
}
export interface StreamEventDone {
  type: "done";
}
export interface StreamEventError {
  type: "error";
  error: string;
}
/**
 * Emitted at the end of a successful agent turn. Carries the full
 * Anthropic-format message history (user + assistant text + tool_use +
 * tool_result blocks) so the client can replace its transcript and the
 * agent has full memory on the next POST.
 */
export interface StreamEventFinalMessages {
  type: "final_messages";
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
}

export type StreamEvent =
  | StreamEventText
  | StreamEventToolUse
  | StreamEventToolResult
  | StreamEventDone
  | StreamEventError
  | StreamEventFinalMessages;
