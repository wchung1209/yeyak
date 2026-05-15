import { clsx } from "clsx";
import type { ChatToolCallMessage } from "./types";

const LABELS: Record<string, string> = {
  search_restaurants: "Searching Resy",
  check_availability: "Checking availability",
  create_reservation_task: "Setting up your reservation watch",
  book_reservation: "Booking your table",
  get_bookings: "Fetching your bookings",
  cancel_reservation: "Cancelling reservation",
};

export function ToolCallDisplay({ message }: { message: ChatToolCallMessage }) {
  const label = LABELS[message.toolName] ?? message.toolName;
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span
        className={clsx("inline-block h-2 w-2 rounded-full", {
          "animate-pulse bg-brass": message.status === "running",
          "bg-sage": message.status === "done",
          "bg-red-500": message.status === "error",
        })}
      />
      <span>
        {label}
        {message.status === "running" && "…"}
      </span>
    </div>
  );
}
