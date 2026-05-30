/**
 * Sniper job — runs on every cron tick.
 *
 * For each active reservation_task:
 *   1. Open one MCP session (logged in if user has Resy creds).
 *   2. Call check_availability.
 *   3. If no slot in window → update last_checked_at and move on.
 *   4. If match & notify_only → email/sms the user, don't book.
 *   5. If match & auto-book → call book(), insert reservation, mark task
 *      booked, notify user.
 *
 * Tasks with `target_date < today` are flipped to `expired` up-front.
 *
 * Tasks created before the restaurant_url migration (#19) won't have a
 * URL — those are skipped with a warning. Users can re-create them
 * once the agent is upgraded to capture URLs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReservationTask } from "@yeyak/types";
import {
  ResyMcpError,
  fetchResyCredentials,
  withResySession,
  type ResyMcpConfig,
} from "@yeyak/resy";
import { sendEmail, sendSms } from "../lib/notifications.js";

interface RunSniperCycleArgs {
  supabase: SupabaseClient;
  apifyToken: string;
}

interface ProfileSnapshot {
  email: string | null;
  notify_email: boolean;
  notify_sms: boolean;
  phone: string | null;
}

export async function runSniperCycle({
  supabase,
  apifyToken,
}: RunSniperCycleArgs): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  // Mark expired tasks up-front so we never bill on them. A task is
  // expired when its LATEST date (target_date_end if set, else
  // target_date) is in the past — a range that starts in the past but
  // ends in the future is still actionable, we just skip the past dates.
  await supabase
    .from("reservation_tasks")
    .update({ status: "expired", resolved_at: new Date().toISOString() })
    .eq("status", "active")
    .or(`target_date_end.lt.${today},and(target_date_end.is.null,target_date.lt.${today})`);

  // Fetch all currently-active tasks. We filter the polled date list
  // per-task below so a range starting yesterday but ending next week
  // still gets polled (just skipping yesterday).
  const { data: tasks, error } = await supabase
    .from("reservation_tasks")
    .select("*")
    .eq("status", "active");
  if (error) {
    console.error("[sniper] could not fetch tasks", error);
    return;
  }

  console.log(`[sniper] polling ${tasks?.length ?? 0} active tasks`);
  await supabase.from("activity_log").insert({
    event_type: "sniper_poll",
    description: `Polling ${tasks?.length ?? 0} active tasks`,
  });

  for (const task of (tasks ?? []) as ReservationTask[]) {
    try {
      await handleTask(task, { supabase, apifyToken });
    } catch (err) {
      // ResyMcpError carries .kind for downstream classification, but
      // here we just log — one task failing doesn't stop the cycle.
      const detail =
        err instanceof ResyMcpError ? `${err.kind}: ${err.message}` : err;
      console.error(`[sniper] task ${task.id} failed`, detail);
    }
  }
}

async function handleTask(
  task: ReservationTask,
  { supabase, apifyToken }: RunSniperCycleArgs,
): Promise<void> {
  if (!task.restaurant_url) {
    console.warn(
      `[sniper] task ${task.id} has no restaurant_url; skipping (recreate via agent)`,
    );
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const datesToCheck = buildDateRange(
    task.target_date < today ? today : task.target_date,
    task.target_date_end ?? task.target_date,
  );
  if (datesToCheck.length === 0) {
    // Range is entirely in the past (the cycle-level expiry sweep
    // should already have flipped this; defensive no-op).
    return;
  }

  const profile = await loadProfile(supabase, task.user_id);
  const credentials = await fetchResyCredentials(supabase, task.user_id);

  const config: ResyMcpConfig = {
    apifyToken,
    supabase,
    source: "sniper",
    userId: task.user_id,
    sessionId: "sniper",
    // Abort the Apify actor as soon as this task completes. Worker
    // runs hourly; keeping the actor warm between tasks within a
    // single cron tick is fine (refcount handles concurrent tasks),
    // but we don't want it billing in the 59 minutes between ticks.
    keepaliveMs: 0,
  };

  // One MCP session per task, reused across every date in the range.
  // Authenticated only if we have creds — unauth can poll availability
  // but can't book.
  await withResySession(config, credentials, async (resy) => {
    const windowStart = task.time_start.slice(0, 5);
    const windowEnd = task.time_end.slice(0, 5);

    for (const date of datesToCheck) {
      const venue = await resy.checkAvailability(
        {
          restaurantUrl: task.restaurant_url!,
          date,
          partySize: task.party_size,
        },
        { venueId: task.venue_id, restaurantName: task.restaurant_name },
      );

      const match = venue.slots.find(
        (slot) => slot.time >= windowStart && slot.time <= windowEnd,
      );
      if (!match) continue;

      // Notify-only mode (legacy rows only — new tasks always auto-book).
      if (task.notify_only) {
        if (profile?.notify_email && profile.email) {
          await sendEmail({
            to: profile.email,
            subject: `A slot opened at ${task.restaurant_name}`,
            html:
              `<p>A table opened up at <strong>${task.restaurant_name}</strong> ` +
              `on ${date} at ${match.time}.</p>` +
              `<p>Open Yeyak to book it before it's gone.</p>`,
          });
        }
        await markLastChecked(supabase, task.id);
        return;
      }

      if (!credentials) {
        console.warn(
          `[sniper] task ${task.id} has auto-book on but user has no Resy creds; skipping`,
        );
        await markLastChecked(supabase, task.id);
        return;
      }

      // First match wins. Book it, update DB, notify, exit the loop.
      const booking = await resy.book(match.configToken, {
        venueId: task.venue_id,
        restaurantName: task.restaurant_name,
      });

      await supabase.from("reservations").insert({
        user_id: task.user_id,
        task_id: task.id,
        platform: "resy",
        platform_id: booking.resyToken,
        restaurant_name: task.restaurant_name,
        venue_id: task.venue_id,
        date,
        time: `${match.time}:00`,
        party_size: task.party_size,
        booked_by: "sniper",
        raw_data: booking.raw,
      });

      await supabase
        .from("reservation_tasks")
        .update({
          status: "booked",
          resolved_at: new Date().toISOString(),
          last_checked_at: new Date().toISOString(),
        })
        .eq("id", task.id);

      await supabase.from("activity_log").insert({
        user_id: task.user_id,
        event_type: "sniper_booked",
        description: `${task.restaurant_name} · ${date} ${match.time}`,
        metadata: { task_id: task.id, resy_token: booking.resyToken, date },
      });

      const summary = `${task.restaurant_name} · ${date} at ${match.time} for ${task.party_size}`;
      if (profile?.notify_email && profile.email) {
        await sendEmail({
          to: profile.email,
          subject: `Your table at ${task.restaurant_name} is confirmed`,
          html: `<p>Your reservation is confirmed.</p><p><strong>${summary}</strong></p>`,
        }).catch((e) => console.error("[sniper] email failed", e));
      }
      if (profile?.notify_sms && profile.phone) {
        await sendSms({
          to: profile.phone,
          body: `Yeyak: Confirmed — ${summary}.`,
        }).catch((e) => console.error("[sniper] sms failed", e));
      }
      return; // First match in the range books; no further dates checked.
    }

    // No date in the range had a matching slot this tick.
    await markLastChecked(supabase, task.id);
  });
}

/** Inclusive list of ISO dates from `start` to `end`. */
function buildDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return [];
  }
  for (let t = startMs; t <= endMs; t += 24 * 60 * 60 * 1000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

async function markLastChecked(
  supabase: SupabaseClient,
  taskId: string,
): Promise<void> {
  await supabase
    .from("reservation_tasks")
    .update({ last_checked_at: new Date().toISOString() })
    .eq("id", taskId);
}

async function loadProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileSnapshot | null> {
  // The profile holds notification prefs only — Resy credentials are
  // fetched separately via `fetchResyCredentials` (which reads the vault
  // secret). The auth email comes from `auth.users`, not `profiles`.
  const { data: profile } = await supabase
    .from("profiles")
    .select("notify_email, notify_sms, phone")
    .eq("id", userId)
    .single();
  if (!profile) return null;
  const { data: user } = await supabase.auth.admin.getUserById(userId);
  return {
    email: user?.user?.email ?? null,
    notify_email: profile.notify_email,
    notify_sms: profile.notify_sms,
    phone: profile.phone,
  };
}
