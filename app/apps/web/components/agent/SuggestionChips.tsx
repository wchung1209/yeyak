"use client";

/**
 * Quick-reply chips. The agent emits these via the `suggest_replies` tool;
 * each chip's text is sent verbatim back to the agent on click.
 */
export function SuggestionChips({
  suggestions,
  onPick,
}: {
  suggestions: string[];
  onPick: (text: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {suggestions.map((s, i) => (
        <button
          key={`${i}-${s}`}
          onClick={() => onPick(s)}
          className="rounded-full border border-ink/15 bg-white px-3 py-1 text-xs text-ink transition hover:border-brass hover:bg-brass/10"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
