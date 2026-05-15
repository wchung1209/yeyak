"use client";

type Card = { key: string; title: string; description: string; href?: string; seed?: string };

const CARDS: Card[] = [
  {
    key: "discover",
    title: "Discover a restaurant",
    description: "By cuisine, neighborhood, or vibe.",
    seed: "Help me discover a restaurant.",
  },
  {
    key: "reserve",
    title: "Make a reservation",
    description: "Tell me where and when. I'll handle the rest.",
    seed: "I'd like to make a reservation.",
  },
  {
    key: "bookings",
    title: "My bookings",
    description: "Active tasks and confirmed tables.",
    href: "/bookings",
  },
  {
    key: "settings",
    title: "Settings",
    description: "Profile, Resy connection, notifications.",
    href: "/settings",
  },
];

export function EntryOptions({ onSeed }: { onSeed: (text: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 px-5 pb-4">
      {CARDS.map((c) =>
        c.href ? (
          <a
            key={c.key}
            href={c.href}
            className="flex min-h-[110px] flex-col justify-between rounded-xl border border-ink/10 bg-white p-3 text-left transition hover:border-brass"
          >
            <h3 className="font-serif text-base">{c.title}</h3>
            <p className="text-xs text-muted">{c.description}</p>
          </a>
        ) : (
          <button
            key={c.key}
            onClick={() => c.seed && onSeed(c.seed)}
            className="flex min-h-[110px] flex-col justify-between rounded-xl border border-ink/10 bg-white p-3 text-left transition hover:border-brass"
          >
            <h3 className="font-serif text-base">{c.title}</h3>
            <p className="text-xs text-muted">{c.description}</p>
          </button>
        ),
      )}
    </div>
  );
}
