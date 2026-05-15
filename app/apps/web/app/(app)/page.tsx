/**
 * Chat home — renders the chat surface. State lives in <ChatProvider>
 * up in `(app)/layout.tsx` so it survives navigation to other tabs.
 */
import { ChatShell } from "@/components/agent/ChatShell";

export default function ChatHomePage() {
  return <ChatShell />;
}
