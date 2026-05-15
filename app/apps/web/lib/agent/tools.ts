/**
 * Claude tool definitions + executors for the reservationist agent.
 *
 * Tools are stateless from Claude's perspective: each invocation receives a
 * fully-built `ToolContext` (user id, supabase service client, an open Resy
 * MCP session) from the Route Handler. The session is created once per
 * agent turn via `withResySession` so every tool call in that turn shares
 * the same authenticated MCP connection.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findCachedToolResult, type ResySession } from "@yeyak/resy";

// ─── Tool input schemas (runtime-validated with zod) ────────────────
//
// These match the TOOL definitions Claude sees. Field names are
// camelCase / domain-shaped; the MCP client translates to the actor's
// snake_case wire format internally.

const SearchInput = z.object({
  city: z.string().describe("Full city name, e.g. 'New York', 'Los Angeles'"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  partySize: z.number().int().min(1).max(20),
  cuisine: z.string().optional(),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

const CheckAvailabilityInput = z.object({
  restaurantUrl: z
    .string()
    .url()
    .describe("Full Resy URL, e.g. https://resy.com/cities/new-york-ny/le-gratin"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  partySize: z.number().int().min(1).max(20),
});

const CreateTaskInput = z.object({
  venueId: z.string(),
  restaurantName: z.string(),
  restaurantUrl: z.string().url(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeStart: z.string().regex(/^\d{2}:\d{2}$/),
  timeEnd: z.string().regex(/^\d{2}:\d{2}$/),
  partySize: z.number().int().min(1).max(20),
});

const BookInput = z.object({
  configToken: z.string(),
  venueId: z.string(),
  restaurantName: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  partySize: z.number().int().min(1).max(20),
  taskId: z.string().uuid().optional(),
});

const GetBookingsInput = z.object({});

const CancelReservationInput = z.object({
  reservationId: z.string().uuid(),
});

const CancelTaskInput = z.object({
  taskId: z.string().uuid(),
});

const SuggestRepliesInput = z.object({
  suggestions: z.array(z.string().min(1).max(40)).min(2).max(4),
});

// ─── Claude-facing tool definitions ────────────────────────────────
export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_restaurants",
    description:
      "Search Resy for restaurants in a city. Returns venues with name, cuisine, price, rating, and a peek at availability slots (each slot includes a configToken used to book). Call this AT MOST ONCE per user request — the first result is canonical.",
    input_schema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "Full city name, e.g. 'New York', 'Los Angeles', 'London'",
        },
        date: {
          type: "string",
          description:
            "ISO date YYYY-MM-DD. OMIT this field unless the user named a specific date — the actor defaults to today and that is almost always what you want. When the user does name a date (e.g. 'tomorrow', 'Friday'), compute it from the DATE ANCHOR in your system prompt. Never use your training-data calendar to compute dates.",
        },
        partySize: { type: "integer", minimum: 1, maximum: 20 },
        cuisine: {
          type: "string",
          description:
            "Cuisine label, e.g. 'Italian', 'Japanese'. Use this whenever the user names a cuisine — it filters the result list. Don't pass vibe words here ('cozy', 'romantic', 'buzzy').",
        },
        query: {
          type: "string",
          description:
            "ONLY use this when the user names a specific restaurant (e.g. 'Carbone', 'Don Angie'). Do NOT use for vibe descriptors, neighborhood names, or general keywords — Resy fuzzy-matches and you'll pull in irrelevant venues. Vibe words belong nowhere in this tool's args; rely on cuisine + the user's defaults instead.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 8,
          description:
            "How many venues to return. Default 4. Keep this small (≤4) — the user reads cards, not lists. Only raise above 4 if the user explicitly asks for more options.",
        },
      },
      required: ["city", "partySize"],
    },
  },
  {
    name: "check_availability",
    description:
      "Get the precise list of available time slots for one venue on one date. Returns the venue with its slot list (each slot has a configToken). Use this directly when the user names a specific restaurant — don't call search_restaurants first.",
    input_schema: {
      type: "object",
      properties: {
        restaurantUrl: {
          type: "string",
          description: "Full Resy URL of the restaurant.",
        },
        date: {
          type: "string",
          description:
            "ISO date YYYY-MM-DD. OMIT unless the user named a specific date — the actor defaults to today. When the user does name a date, compute it from the DATE ANCHOR in your system prompt; never from your training-data calendar.",
        },
        partySize: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["restaurantUrl", "partySize"],
    },
  },
  {
    name: "create_reservation_task",
    description:
      "Create a monitoring task. The sniper worker polls Resy every hour on the hour and AUTO-BOOKS the moment a slot opens inside the user's time window — no further confirmation needed. Use when the user names a venue + date/party for which there's no current availability and asks Yeyak to watch for an opening. The user is notified by email + SMS (per their settings) the moment a booking lands. Window defaults: ±15 minutes around the user's preferred time, unless the user explicitly states a wider/narrower range.",
    input_schema: {
      type: "object",
      properties: {
        venueId: { type: "string" },
        restaurantName: { type: "string" },
        restaurantUrl: {
          type: "string",
          description: "Full Resy URL — needed by the worker to poll.",
        },
        date: { type: "string" },
        timeStart: {
          type: "string",
          description:
            "HH:MM lower bound of the booking window (24h). Default to user's preferred time minus 15 minutes.",
        },
        timeEnd: {
          type: "string",
          description:
            "HH:MM upper bound of the booking window (24h). Default to user's preferred time plus 15 minutes.",
        },
        partySize: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: [
        "venueId",
        "restaurantName",
        "restaurantUrl",
        "date",
        "timeStart",
        "timeEnd",
        "partySize",
      ],
    },
  },
  {
    name: "book_reservation",
    description:
      "Request a reservation. IMPORTANT: This does NOT immediately book the table. Calling this tool shows a confirmation card to the user with the reservation details. The user must click 'Confirm & book' for the booking to actually fire. Always restate the details in text before calling this tool so the user has context.",
    input_schema: {
      type: "object",
      properties: {
        configToken: { type: "string" },
        venueId: { type: "string" },
        restaurantName: { type: "string" },
        date: { type: "string" },
        time: { type: "string" },
        partySize: { type: "integer", minimum: 1, maximum: 20 },
        taskId: { type: "string" },
      },
      required: [
        "configToken",
        "venueId",
        "restaurantName",
        "date",
        "time",
        "partySize",
      ],
    },
  },
  {
    name: "get_bookings",
    description: "List the user's active monitoring tasks and confirmed reservations.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "cancel_reservation",
    description:
      "Cancel a CONFIRMED RESERVATION (a booked table) by reservation id. Calls Resy under the hood and flips the DB record to cancelled. Use when the user references a booking they've already confirmed. Do NOT use this for monitors / watches — those are tasks; use cancel_reservation_task instead.",
    input_schema: {
      type: "object",
      properties: { reservationId: { type: "string" } },
      required: ["reservationId"],
    },
  },
  {
    name: "cancel_reservation_task",
    description:
      "Cancel a MONITORING TASK (a watch / sniper job) by task id. Use when the user wants to stop watching a venue for an opening. Reservation tasks come back from get_bookings under `tasks[].id`. Do NOT use this for confirmed reservations — those are reservations; use cancel_reservation instead.",
    input_schema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "suggest_replies",
    description:
      "Offer the user 2–4 short clickable follow-up replies as chips below your message. Use this AFTER you've asked a question or presented options, to save the user typing. Each suggestion must be a short, complete user-style reply (e.g. '7 PM', 'Yes, book it', 'Try a different spot', 'Watch this one'). Pick the best 2–4 once per turn — don't call this tool more than once.",
    input_schema: {
      type: "object",
      properties: {
        suggestions: {
          type: "array",
          items: { type: "string", maxLength: 40 },
          minItems: 2,
          maxItems: 4,
        },
      },
      required: ["suggestions"],
    },
  },
];

// ─── Tool executor ─────────────────────────────────────────────────

export interface ToolContext {
  userId: string;
  supabase: SupabaseClient;
  /** Authenticated (or anonymous) Resy MCP session for this turn. */
  resy: ResySession;
  /** True iff `resy` was opened with credentials (i.e. login succeeded). */
  resyAuthenticated: boolean;
  /** Chat session id — used to scope tool_call_log dedup lookups. */
  sessionId: string;
}

/**
 * Stock response we return from any Resy-touching tool when the user
 * has not connected their Resy account yet. The agent surfaces this to
 * the user as "go to Settings" guidance — see prompts.ts for the
 * matching directive.
 */
const RESY_REQUIRED = {
  error: "no_resy_credentials",
  message:
    "Connect your Resy account in Settings before searching, monitoring, or booking. Yeyak needs the credentials to fetch live availability and hold tables.",
} as const;

export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  switch (name) {
    case "search_restaurants": {
      if (!ctx.resyAuthenticated) return RESY_REQUIRED;
      const input = SearchInput.parse(rawInput);
      return ctx.resy.search({
        city: input.city,
        date: input.date,
        partySize: input.partySize,
        cuisine: input.cuisine,
        query: input.query,
        limit: input.limit,
      });
    }

    case "check_availability": {
      if (!ctx.resyAuthenticated) return RESY_REQUIRED;
      const input = CheckAvailabilityInput.parse(rawInput);

      // Hard dedup: if the agent has already checked the same
      // {venue, date, party} this session, refuse the call entirely.
      // The slot list is in the prior tool_result — the LLM should
      // pluck the configToken and call book_reservation directly.
      // ChatShell silently removes the spinner placeholder when it
      // sees this error, so there's no redundant card on screen.
      const wireArgs = {
        restaurant_url: input.restaurantUrl,
        date: input.date ?? null,
        party_size: input.partySize,
      };
      const prior = await findCachedToolResult({
        supabase: ctx.supabase,
        sessionId: ctx.sessionId,
        toolName: "check_availability",
        wireArgs,
      });
      if (prior) {
        return {
          error: "duplicate_check_availability",
          message:
            "You already checked availability for this venue/date/party this conversation. Look at the slots array in your earlier check_availability tool_result, find the slot whose `time` matches the user's choice (in 24h HH:MM), and call book_reservation with that slot's configToken. Do NOT call check_availability again.",
        };
      }

      return ctx.resy.checkAvailability({
        restaurantUrl: input.restaurantUrl,
        date: input.date,
        partySize: input.partySize,
      });
    }

    case "create_reservation_task": {
      if (!ctx.resyAuthenticated) return RESY_REQUIRED;
      const input = CreateTaskInput.parse(rawInput);
      // notify_only is intentionally hardcoded false: monitors always
      // auto-book per product spec. The DB column stays for backward
      // compat with old rows; the worker still honors it on those.
      const { data, error } = await ctx.supabase
        .from("reservation_tasks")
        .insert({
          user_id: ctx.userId,
          venue_id: input.venueId,
          restaurant_name: input.restaurantName,
          restaurant_url: input.restaurantUrl,
          target_date: input.date,
          time_start: input.timeStart,
          time_end: input.timeEnd,
          party_size: input.partySize,
          notify_only: false,
        })
        .select()
        .single();
      if (error) throw new Error(`Could not create task: ${error.message}`);
      await ctx.supabase.from("activity_log").insert({
        user_id: ctx.userId,
        event_type: "task_created",
        description: `Monitoring ${input.restaurantName} on ${input.date}`,
        metadata: input,
      });
      return { taskId: data.id, status: "active" as const };
    }

    case "book_reservation": {
      if (!ctx.resyAuthenticated) return RESY_REQUIRED;
      const input = BookInput.parse(rawInput);
      // This tool does NOT book. It only emits a `pending_confirmation`
      // payload that the chat UI renders as a ConfirmBookingCard. The
      // actual booking happens when the user clicks Confirm in that
      // card, which POSTs to /api/bookings/confirm.
      return {
        status: "pending_confirmation" as const,
        configToken: input.configToken,
        venueId: input.venueId,
        restaurantName: input.restaurantName,
        date: input.date,
        time: input.time,
        partySize: input.partySize,
        taskId: input.taskId ?? null,
      };
    }

    case "get_bookings": {
      GetBookingsInput.parse(rawInput);
      const [{ data: tasks }, { data: reservations }] = await Promise.all([
        ctx.supabase
          .from("reservation_tasks")
          .select("*")
          .eq("user_id", ctx.userId)
          .eq("status", "active"),
        ctx.supabase
          .from("reservations")
          .select("*")
          .eq("user_id", ctx.userId)
          .eq("status", "confirmed"),
      ]);
      return { tasks: tasks ?? [], reservations: reservations ?? [] };
    }

    case "suggest_replies": {
      // Pure UI side-effect: the suggestions are streamed to the client
      // via the tool_use event itself; this executor just acks so the
      // agent can continue.
      const input = SuggestRepliesInput.parse(rawInput);
      return { accepted: true, count: input.suggestions.length };
    }

    case "cancel_reservation": {
      const input = CancelReservationInput.parse(rawInput);
      const { data: res, error: fetchErr } = await ctx.supabase
        .from("reservations")
        .select("*")
        .eq("id", input.reservationId)
        .eq("user_id", ctx.userId)
        .single();
      if (fetchErr || !res) return { error: "Reservation not found." };
      if (!ctx.resyAuthenticated) {
        return { error: "Connect your Resy account in Settings to cancel." };
      }
      // `platform_id` stores the Resy `resy_token` (used to cancel).
      if (res.platform_id) {
        await ctx.resy.cancel(res.platform_id);
      }
      await ctx.supabase
        .from("reservations")
        .update({ status: "cancelled" })
        .eq("id", input.reservationId);
      await ctx.supabase.from("activity_log").insert({
        user_id: ctx.userId,
        event_type: "booking_cancelled",
        description: `${res.restaurant_name} cancelled`,
        metadata: { reservation_id: res.id },
      });
      return { cancelled: true };
    }

    case "cancel_reservation_task": {
      const input = CancelTaskInput.parse(rawInput);
      const { data: task, error: fetchErr } = await ctx.supabase
        .from("reservation_tasks")
        .select("id, restaurant_name, status")
        .eq("id", input.taskId)
        .eq("user_id", ctx.userId)
        .single();
      if (fetchErr || !task) return { error: "Monitor not found." };
      if (task.status !== "active") {
        return { cancelled: false, alreadyResolved: true, status: task.status };
      }
      const { error: updateErr } = await ctx.supabase
        .from("reservation_tasks")
        .update({ status: "cancelled", resolved_at: new Date().toISOString() })
        .eq("id", input.taskId);
      if (updateErr) return { error: `Could not cancel: ${updateErr.message}` };
      await ctx.supabase.from("activity_log").insert({
        user_id: ctx.userId,
        event_type: "task_cancelled",
        description: `Monitor cleared: ${task.restaurant_name}`,
        metadata: { task_id: task.id },
      });
      return { cancelled: true };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
