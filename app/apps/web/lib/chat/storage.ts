/**
 * Chat persistence — `sessionStorage`-backed.
 *
 * Why sessionStorage (and not localStorage / DB):
 *   - Survives navigation between Chat / Settings / Bookings tabs.
 *   - Survives page reloads within the same tab.
 *   - Clears automatically when the tab closes — matches our "exits the
 *     webpage" reset rule.
 *   - No server round-trip; no schema to migrate when chat shapes change.
 *
 * Resets are explicit:
 *   - Click the Yeyak header → ChatShell.resetChat() → clearChatState().
 *   - Sign out → SettingsForm.signOut() → clearChatState().
 *
 * The shape is versioned. Old shapes are ignored on load (return null) so
 * we can evolve `ChatMessage` without crashing on stored payloads.
 */
import type { ChatMessage } from "@/components/agent/types";

const STORAGE_KEY = "yeyak.chat.v1";

export interface ChatTranscriptEntry {
  role: "user" | "assistant";
  content: unknown;
}

export interface ChatStorageShape {
  v: 1;
  sessionId: string;
  messages: ChatMessage[];
  transcript: ChatTranscriptEntry[];
}

export function loadChatState(): ChatStorageShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChatStorageShape>;
    if (
      parsed?.v !== 1 ||
      typeof parsed.sessionId !== "string" ||
      !Array.isArray(parsed.messages) ||
      !Array.isArray(parsed.transcript)
    ) {
      return null;
    }
    return parsed as ChatStorageShape;
  } catch {
    return null;
  }
}

export function saveChatState(state: ChatStorageShape): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or storage disabled — non-fatal.
  }
}

export function clearChatState(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
