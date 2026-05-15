"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";

/**
 * Brief intro overlay that shows the Yeyak wordmark on first mount,
 * then fades out. Mounted in `(app)/layout.tsx` — because the layout
 * doesn't unmount when the user navigates between tabs (Next.js App
 * Router) and our chat state is hoisted there, the splash fires once
 * per page load and stays out of the way during navigation.
 *
 * Timeline (total ~1500ms):
 *   0–1000ms   fully opaque, holding the wordmark
 *   1000–1500  fading to transparent
 *   1500ms     component unmounts so it can't intercept clicks
 */
export function Splash() {
  const [fading, setFading] = useState(false);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    const fadeStart = setTimeout(() => setFading(true), 1000);
    const fullyGone = setTimeout(() => setRemoved(true), 1500);
    return () => {
      clearTimeout(fadeStart);
      clearTimeout(fullyGone);
    };
  }, []);

  if (removed) return null;

  return (
    <div
      aria-hidden
      className={clsx(
        // pointer-events-none lets the chat surface beneath us still
        // accept input the moment we start fading; we still cover the
        // viewport visually.
        "pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-cream transition-opacity duration-500 ease-out",
        fading ? "opacity-0" : "opacity-100",
      )}
    >
      <h1 className="font-serif text-5xl tracking-tight text-ink">Yeyak</h1>
    </div>
  );
}
