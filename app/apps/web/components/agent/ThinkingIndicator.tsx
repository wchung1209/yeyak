/**
 * Subtle "Yeyak is thinking…" indicator shown while a turn is mid-flight.
 *
 * Distinct from the per-tool-call placeholder ("Searching Resy…") which
 * fires after the agent has decided to call a tool. This indicator
 * covers the other moments — initial reasoning, between tool calls, and
 * the final synthesis — so the user can tell the system is alive even
 * when nothing is streaming yet.
 */
export function ThinkingIndicator() {
  return (
    <div
      className="flex items-center gap-2 text-xs text-muted"
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center gap-1">
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40 [animation-delay:0ms]" />
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40 [animation-delay:120ms]" />
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40 [animation-delay:240ms]" />
      </span>
      <span>Yeyak is thinking…</span>
    </div>
  );
}
