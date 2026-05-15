import { clsx } from "clsx";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <span
      className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", {
        "bg-ink/10 text-ink": tone === "neutral",
        "bg-sage/15 text-sage": tone === "success",
        "bg-yellow-100 text-yellow-800": tone === "warning",
        "bg-red-100 text-red-700": tone === "danger",
        "bg-blue-100 text-blue-700": tone === "info",
      })}
    >
      {children}
    </span>
  );
}
