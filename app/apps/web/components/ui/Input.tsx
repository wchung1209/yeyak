import { clsx } from "clsx";
import type { InputHTMLAttributes } from "react";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-brass",
        className,
      )}
    />
  );
}
