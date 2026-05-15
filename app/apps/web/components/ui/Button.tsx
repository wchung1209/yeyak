import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        {
          "bg-ink text-cream hover:bg-ink/90": variant === "primary",
          "bg-brass text-white hover:bg-brass/90": variant === "secondary",
          "bg-transparent text-ink hover:bg-ink/5": variant === "ghost",
          "bg-red-600 text-white hover:bg-red-700": variant === "danger",
        },
        className,
      )}
    />
  );
}
