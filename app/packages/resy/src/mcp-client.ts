/**
 * Resy MCP client.
 *
 * Talks to the `clearpath/resy-booker` Apify MCP server. A "session" is
 * one MCP connection — optionally authenticated via `login` — that lets
 * you call the six tools the actor exposes.
 *
 * Lifecycle is managed via `withResySession`:
 *
 *   await withResySession(config, credentials, async (session) => {
 *     const venues = await session.search({ city: "New York" });
 *     // …
 *   });
 *
 * The callback's return value flows through. The MCP transport is closed
 * on both happy-path and error-path.
 *
 * Login is **lazy**: `withResySession(config, credentials, fn)` does NOT
 * log in eagerly even if `credentials` are provided. The first
 * authenticated tool that fires (book, myReservations, cancel) triggers
 * a single `login` call. Unauthenticated tools (search, checkAvailability)
 * never log in. This avoids re-hitting Resy's login endpoint on
 * narration-only agent turns and on repeated short-lived sessions.
 *
 * Resilience: Apify Standby occasionally drops session ids mid-turn
 * ("Session not found" / -32600). For idempotent tools (search,
 * check_availability, my_reservations, login) we automatically reconnect
 * and retry once when we see a transport-like error. `book` and `cancel`
 * are NOT retried — paid + non-idempotent.
 *
 * Billable calls (`search`, `check_availability`, `book`) write a row to
 * `cost_events` BEFORE the call fires. If the call throws, the row is
 * flipped to `failed = true` for reconciliation. Non-billable calls
 * (`login`, `my_reservations`, `cancel`) skip cost logging.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APIFY_COSTS,
  RESY_TOOL,
  mapWireReservation,
  mapWireVenue,
  type CostAction,
  type CostSource,
  type ResyBookingResult,
  type ResyCredentials,
  type ResyReservation,
  type ResyVenue,
  type ResyWireBookInput,
  type ResyWireBookSuccess,
  type ResyWireCancelInput,
  type ResyWireCancelSuccess,
  type ResyWireCheckAvailabilityInput,
  type ResyWireCheckAvailabilityOutput,
  type ResyWireLoginInput,
  type ResyWireLoginSuccess,
  type ResyWireMyReservationsInput,
  type ResyWireMyReservationsOutput,
  type ResyWireSearchInput,
  type ResyWireSearchOutput,
} from "@yeyak/types";
import { findCachedToolResult } from "./cache";
import { ResyMcpError, isTransportLikeError } from "./errors";
import { ToolCallLogger } from "./tool-log";
import { unwrapStructured } from "./unwrap";

// ═════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═════════════════════════════════════════════════════════════════════

export const RESY_MCP_URL = "https://clearpath--resy-booker.apify.actor/mcp";

/**
 * Apify actor identifier used for run-management API calls (abort).
 * Different from RESY_MCP_URL: the Standby endpoint uses double-dash
 * (`clearpath--resy-booker.apify.actor`) while the run-management API
 * uses tilde (`clearpath~resy-booker`).
 *
 * We hard-code this rather than parsing config.mcpUrl because tests or
 * self-hosting may point mcpUrl elsewhere; the abort API call still
 * targets the prod actor by design.
 */
const APIFY_RESY_ACTOR_ID = "clearpath~resy-booker";

/** Timeout for the abort REST call. Best-effort cleanup — don't hold the response. */
const APIFY_ABORT_TIMEOUT_MS = 3_000;

/**
 * Best-effort: POST Apify's "abort last run" endpoint for the
 * clearpath/resy-booker actor scoped to the caller's token. Returns
 * silently on any failure — Apify's own idle-shutdown (if any) and
 * the next session's abort form a safety net. Compute-time billing
 * stops once the actor is aborted.
 */
async function abortStandbyActor(apifyToken: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APIFY_ABORT_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_RESY_ACTOR_ID}/runs/last/abort`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apifyToken}` },
        signal: controller.signal,
      },
    );
    if (!res.ok && res.status !== 404) {
      console.warn(
        `[resy-mcp] actor abort returned HTTP ${res.status}; will retry on next session`,
      );
    }
  } catch (err) {
    console.warn(`[resy-mcp] actor abort failed: ${describe(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Module-level keepalive coordination. Shared across all withResySession
 * calls in the same process so concurrent sessions don't abort each
 * other's actor and back-to-back sessions reuse a warm actor.
 *
 * Keyed by Apify token (effectively per-Yeyak-account). Each entry
 * tracks the number of currently-open sessions (refcount) and any
 * pending abort timer.
 *
 * Caveat: serverless runtimes (Vercel, Lambda) may freeze the process
 * after the HTTP response, in which case the pending setTimeout never
 * fires. The actor remains warm until either (a) the next session
 * opens and triggers an abort on close, or (b) Apify's idle shutdown
 * (if any) kicks in. Worst case is identical to today's behaviour, so
 * the keepalive is safe to layer on without a Redis dependency.
 */
interface KeepaliveEntry {
  /** How many withResySession callers currently hold this actor open. */
  activeCount: number;
  /** Pending abort timer (null when none scheduled). */
  pendingAbort: ReturnType<typeof setTimeout> | null;
}

const keepaliveByToken = new Map<string, KeepaliveEntry>();

function onSessionOpen(apifyToken: string): void {
  let entry = keepaliveByToken.get(apifyToken);
  if (!entry) {
    entry = { activeCount: 0, pendingAbort: null };
    keepaliveByToken.set(apifyToken, entry);
  }
  if (entry.pendingAbort) {
    clearTimeout(entry.pendingAbort);
    entry.pendingAbort = null;
  }
  entry.activeCount += 1;
}

function onSessionClose(apifyToken: string, keepaliveMs: number): void {
  const entry = keepaliveByToken.get(apifyToken);
  if (!entry) return;
  entry.activeCount = Math.max(0, entry.activeCount - 1);
  if (entry.activeCount > 0) {
    // Another session still holds this actor; do not schedule abort.
    return;
  }
  if (keepaliveMs <= 0) {
    keepaliveByToken.delete(apifyToken);
    void abortStandbyActor(apifyToken);
    return;
  }
  entry.pendingAbort = setTimeout(() => {
    keepaliveByToken.delete(apifyToken);
    void abortStandbyActor(apifyToken);
  }, keepaliveMs);
  // Allow the Node process to exit even if this timer is still queued.
  // Critical for the worker — without unref(), a 30s keepalive (if
  // accidentally set) would block process exit between cron ticks.
  if (typeof entry.pendingAbort.unref === "function") {
    entry.pendingAbort.unref();
  }
}

export interface ResyMcpConfig {
  /** Apify API token; Bearer-authed to the Standby MCP endpoint. */
  apifyToken: string;
  /** Override the MCP endpoint (tests, self-host). Defaults to prod. */
  mcpUrl?: string;
  /** Service-role Supabase client — used for cost_events + tool_call_log. */
  supabase: SupabaseClient;
  /** "agent" | "sniper" — recorded on every cost_events + tool_call_log row. */
  source: CostSource;
  /** Attribute the cost to this user. Null when unattributed. */
  userId?: string | null;
  /** Chat session id, or "sniper" for worker calls. */
  sessionId?: string;
  /**
   * Milliseconds to wait after the last open session closes before
   * aborting the Apify Standby actor run. Default 0 = abort
   * immediately. A positive value keeps the actor warm long enough to
   * absorb the next user turn without paying the cold-start cost, but
   * trades that against compute time billed while idle. Sniper passes
   * 0; the chat agent typically passes ~30000.
   *
   * Multiple concurrent withResySession calls share a single abort
   * timer per Apify token (refcounted). A new session opening always
   * cancels a pending abort.
   */
  keepaliveMs?: number;
}

/**
 * Per-call context used only for enriching cost_events rows. Values are
 * copied verbatim onto the log row; they don't affect the Apify call.
 */
export interface ResyCallContext {
  venueId?: string | null;
  restaurantName?: string | null;
}

// ─── Input args (domain-shaped) ───────────────────────────────────────

export interface ResySearchArgs {
  /** Full city name, e.g. "New York" (not slug). */
  city: string;
  partySize?: number;
  /** YYYY-MM-DD. Defaults to today on the actor side. */
  date?: string;
  cuisine?: string;
  query?: string;
  /** Max 25. Default 4 (kept tight for chat UX). */
  limit?: number;
  sort?: "relevance" | "rating" | "slots" | "name";
}

export interface ResyCheckAvailabilityArgs {
  /** Full Resy URL — `https://resy.com/cities/<city>/<slug>`. */
  restaurantUrl: string;
  partySize?: number;
  date?: string;
}

// ─── Session surface ──────────────────────────────────────────────────

export interface ResySession {
  /** Browse venues by city + filters. Paid: $0.03. */
  search(args: ResySearchArgs, ctx?: ResyCallContext): Promise<ResyVenue[]>;
  /** Get precise slot list for one venue/date. Paid: $0.05. */
  checkAvailability(
    args: ResyCheckAvailabilityArgs,
    ctx?: ResyCallContext,
  ): Promise<ResyVenue>;
  /** Redeem a slot's `configToken`. Paid: $3.99. Requires prior `login`. */
  book(configToken: string, ctx?: ResyCallContext): Promise<ResyBookingResult>;
  /** List the logged-in user's reservations. Free. Requires prior `login`. */
  myReservations(): Promise<ResyReservation[]>;
  /** Cancel a reservation. Free. Requires prior `login`. */
  cancel(resyToken: string): Promise<void>;
}

/**
 * Open an MCP connection on demand, run `fn`, and close the transport on
 * both success and failure (only if we actually connected).
 *
 * Connect is **lazy**: this function does NOT touch the network until a
 * session method that needs the transport is called. Cache short-circuits
 * (`findCachedToolResult` hits) and turns where `fn` never invokes a
 * Resy tool (e.g. agent narration after a confirmed booking) make
 * **zero** Apify calls — no actor instance is spawned.
 *
 * Login is also **lazy**: passing `credentials` does NOT immediately
 * call `login`. The first authenticated tool inside `fn` (book,
 * myReservations, cancel) triggers a single login. Pass
 * `credentials: null` to forbid login altogether — authenticated tools
 * will then surface a "no credentials" error rather than logging in.
 */
export async function withResySession<T>(
  config: ResyMcpConfig,
  credentials: ResyCredentials | null,
  fn: (session: ResySession) => Promise<T>,
): Promise<T> {
  const url = new URL(config.mcpUrl ?? RESY_MCP_URL);
  const requestInit: RequestInit = {
    headers: { Authorization: `Bearer ${config.apifyToken}` },
  };

  // Single audit logger shared across login + every session call. Lives
  // for the duration of this MCP connection so all rows for this attempt
  // share the same session_id.
  const toolLogger = new ToolCallLogger({
    supabase: config.supabase,
    source: config.source,
    userId: config.userId,
    sessionId: config.sessionId,
  });

  // Mutable cell — null until the first session call that needs it.
  // `reconnect()` swaps the value in place after a session drop.
  let client: Client | null = null;
  // True once we've logged in on the current `client`. Reset when
  // reconnect() spins up a new connection.
  let loggedIn = false;
  // True once openClient() has succeeded at least once during this
  // withResySession invocation. Used to decide whether to call
  // onSessionClose() in the finally block — narration-only turns that
  // never spawn an actor must NOT touch the refcount or trigger an
  // abort, otherwise we'd kill a warm actor that another concurrent
  // session is still using.
  let didOpen = false;

  /** Raw connect, no retry. Used inside ensureConnected() and reconnect(). */
  async function openClient(): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(url, { requestInit });
    const c = new Client({ name: "yeyak", version: "0.1.0" });
    await c.connect(transport);
    if (!didOpen) {
      didOpen = true;
      onSessionOpen(config.apifyToken);
    }
    return c;
  }

  /**
   * Idempotent: ensure we have a connected MCP client. First call opens
   * the transport (with one retry on transport-like failures). Later
   * calls return the cached client immediately. ZERO Apify calls happen
   * if no session method ever invokes this.
   */
  async function ensureConnected(): Promise<Client> {
    if (client) return client;
    try {
      client = await openClient();
      return client;
    } catch (err) {
      if (!isTransportLikeError(err)) {
        throw new ResyMcpError(
          "transport",
          `Could not connect to MCP: ${describe(err)}`,
        );
      }
      console.warn(
        `[resy-mcp] initial connect failed, retrying once: ${describe(err)}`,
      );
      try {
        client = await openClient();
        return client;
      } catch (err2) {
        throw new ResyMcpError(
          "transport",
          `Could not connect to MCP after retry: ${describe(err2)}`,
        );
      }
    }
  }

  /**
   * Mid-session reconnect after a "Session not found" / transport drop.
   * Only meaningful when we'd already connected — until then there's
   * nothing to reconnect. Re-logs in ONLY if we'd already logged in on
   * the prior connection. Uses the non-retryable login path because
   * we're already inside callTool's retry chain; recursing would loop.
   */
  async function reconnect(): Promise<void> {
    console.warn("[resy-mcp] reconnecting after transport error");
    if (client) {
      await client.close().catch(() => {
        // Old client may already be in a half-dead state; that's fine.
      });
    }
    client = await openClient();
    if (loggedIn && credentials) {
      await loginNoRetry(client, toolLogger, credentials);
    }
  }

  /** Lazy lookup. Throws if called before ensureConnected. */
  function getClient(): Client {
    if (!client) {
      throw new Error(
        "[resy-mcp] internal: getClient() before ensureConnected()",
      );
    }
    return client;
  }

  /**
   * Idempotent: ensure we're logged in before an authenticated tool
   * fires. Connects the transport first if needed. Throws
   * ResyMcpError("invalid_credentials") if `credentials` is null — the
   * caller asked for an authenticated tool without providing creds.
   */
  async function ensureLoggedIn(): Promise<void> {
    if (loggedIn) return;
    if (!credentials) {
      throw new ResyMcpError(
        "invalid_credentials",
        "This action requires a Resy login. Connect your Resy account in Settings.",
      );
    }
    await ensureConnected();
    await loginRetryable({ getClient, reconnect, toolLogger }, credentials);
    loggedIn = true;
  }

  try {
    const session = buildSession({
      ensureConnected,
      getClient,
      reconnect,
      toolLogger,
      config,
      ensureLoggedIn,
    });
    return await fn(session);
  } finally {
    // The reassignments to `client` happen inside nested async closures
    // (ensureConnected, reconnect) that strict-mode control flow analysis
    // can't trace, so by the time we reach this finally block TS has
    // narrowed `client` to `null`. A type annotation alone (`const c:
    // Client | null = client`) doesn't override that narrowing — TS
    // still derives `c` from the narrowed source. A type assertion
    // (`as Client | null`) explicitly widens it back so the `if`
    // guard can re-narrow to `Client`.
    const c = client as Client | null;
    if (c) {
      await c.close().catch((err) => {
        // Connection cleanup failures shouldn't mask the caller's result.
        console.error("[resy-mcp] client.close() failed", err);
      });
    }
    // Pair onSessionOpen (called inside openClient) with onSessionClose
    // so the keepalive refcount stays balanced. The abort itself fires
    // inside onSessionClose when the refcount drops to zero — either
    // immediately (keepaliveMs <= 0) or after the keepalive window.
    if (didOpen) {
      onSessionClose(config.apifyToken, config.keepaliveMs ?? 0);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════
// INTERNALS
// ═════════════════════════════════════════════════════════════════════

interface CallToolDeps {
  /** Returns the current `Client` — read fresh because reconnect swaps it. */
  getClient: () => Client;
  reconnect: () => Promise<void>;
  toolLogger: ToolCallLogger;
}

/**
 * One-stop wrapper around `client.callTool`. Responsibilities:
 *   1. Cast the wire-input object to the SDK's `Record<string, unknown>`
 *      shape (our wire types are typed object literals without an index
 *      signature, so we widen here once instead of casting at every site).
 *   2. Route the result through `unwrapStructured` — validates shape and
 *      surfaces actor-level failures as `ResyMcpError`.
 *   3. Persist a row to `tool_call_log` (args + result/error + duration)
 *      via the shared `ToolCallLogger`. Each attempt logs its own row.
 *   4. On a transport-like error, optionally reconnect and retry ONCE.
 *      Only enabled for idempotent tools — book/cancel never retry.
 */
async function callTool<TIn extends object, TOut>(
  deps: CallToolDeps,
  name: string,
  args: TIn,
  label: string,
  retryable: boolean,
): Promise<TOut> {
  const exec = async (): Promise<TOut> => {
    const res = await deps.getClient().callTool({
      name,
      arguments: args as Record<string, unknown>,
    });
    return unwrapStructured<TOut>(res, label);
  };

  try {
    return await deps.toolLogger.log(name, args, exec);
  } catch (err) {
    if (!retryable || !isTransportLikeError(err)) throw err;
    console.warn(
      `[resy-mcp] ${name} hit transport error (${describe(err)}); reconnecting and retrying once`,
    );
    await deps.reconnect();
    return await deps.toolLogger.log(name, args, exec);
  }
}

async function loginRetryable(
  deps: CallToolDeps,
  credentials: ResyCredentials,
): Promise<void> {
  const wireArgs: ResyWireLoginInput = {
    email: credentials.email,
    password: credentials.password,
  };
  // Throws ResyMcpError("invalid_credentials") on success=false.
  await callTool<ResyWireLoginInput, ResyWireLoginSuccess>(
    deps,
    RESY_TOOL.login,
    wireArgs,
    "login",
    /* retryable */ true,
  );
}

/**
 * Login without retry. Used inside `reconnect()` — the retryable path
 * would call reconnect() on transport failure, which calls this, which
 * would loop. Logs to tool_call_log directly so reconnect attempts are
 * still visible.
 */
async function loginNoRetry(
  client: Client,
  toolLogger: ToolCallLogger,
  credentials: ResyCredentials,
): Promise<void> {
  const wireArgs: ResyWireLoginInput = {
    email: credentials.email,
    password: credentials.password,
  };
  await toolLogger.log(RESY_TOOL.login, wireArgs, async () => {
    const res = await client.callTool({
      name: RESY_TOOL.login,
      // Same widen-via-unknown trick `callTool` uses; ResyWireLoginInput
      // is a typed object literal without an index signature.
      arguments: wireArgs as unknown as Record<string, unknown>,
    });
    return unwrapStructured<ResyWireLoginSuccess>(res, "login");
  });
}

function buildSession(args: {
  /** Lazy connect — called by every method before its actual MCP call. */
  ensureConnected: () => Promise<Client>;
  getClient: () => Client;
  reconnect: () => Promise<void>;
  toolLogger: ToolCallLogger;
  config: ResyMcpConfig;
  /** Lazy login: called by methods that require an authenticated session. */
  ensureLoggedIn: () => Promise<void>;
}): ResySession {
  const logger = new CostLogger(args.config);
  const deps: CallToolDeps = {
    getClient: args.getClient,
    reconnect: args.reconnect,
    toolLogger: args.toolLogger,
  };

  return {
    // ── Unauthenticated tools — never trigger login ──────────────────
    async search(searchArgs, ctx = {}) {
      const wireArgs: ResyWireSearchInput = {
        city: searchArgs.city,
        party_size: searchArgs.partySize ?? 2,
        date: searchArgs.date ?? null,
        cuisine: searchArgs.cuisine ?? null,
        query: searchArgs.query ?? null,
        limit: searchArgs.limit ?? 4,
        sort: searchArgs.sort ?? "relevance",
      };
      // Cache check happens BEFORE ensureConnected so a hit makes
      // ZERO Apify calls — no actor instance is spawned for a repeat
      // search.
      const cached = await findCachedToolResult({
        supabase: args.config.supabase,
        sessionId: args.config.sessionId,
        toolName: "search_restaurants",
        wireArgs,
      });
      if (cached) {
        const wrapped = cached as { result: ResyWireSearchOutput };
        return wrapped.result.map(mapWireVenue);
      }
      await args.ensureConnected();
      return logger.bill("search", ctx, async () => {
        const wrapped = await callTool<
          ResyWireSearchInput,
          { result: ResyWireSearchOutput }
        >(deps, RESY_TOOL.search, wireArgs, "search_restaurants", /* retryable */ true);
        return wrapped.result.map(mapWireVenue);
      });
    },

    async checkAvailability(checkArgs, ctx = {}) {
      const wireArgs: ResyWireCheckAvailabilityInput = {
        restaurant_url: checkArgs.restaurantUrl,
        date: checkArgs.date ?? null,
        party_size: checkArgs.partySize ?? 2,
      };
      // Cache check before connect — a hit avoids both the $0.05 Resy
      // call AND the actor spawn.
      const cached = await findCachedToolResult({
        supabase: args.config.supabase,
        sessionId: args.config.sessionId,
        toolName: "check_availability",
        wireArgs,
      });
      if (cached) {
        return mapWireVenue(cached as ResyWireCheckAvailabilityOutput);
      }
      await args.ensureConnected();
      return logger.bill("check_availability", ctx, async () => {
        const venue = await callTool<
          ResyWireCheckAvailabilityInput,
          ResyWireCheckAvailabilityOutput
        >(
          deps,
          RESY_TOOL.checkAvailability,
          wireArgs,
          "check_availability",
          /* retryable */ true,
        );
        return mapWireVenue(venue);
      });
    },

    // ── Authenticated tools — trigger lazy connect + login on first use ─
    async book(configToken, ctx = {}) {
      // ensureLoggedIn() handles the connect transitively.
      await args.ensureLoggedIn();
      return logger.bill("book", ctx, async () => {
        const wireArgs: ResyWireBookInput = { config_token: configToken };
        // Not retryable — Apify charges $3.99 and the operation isn't
        // idempotent. Surface the error and let the caller decide.
        const payload = await callTool<ResyWireBookInput, ResyWireBookSuccess>(
          deps,
          RESY_TOOL.book,
          wireArgs,
          "book_reservation",
          /* retryable */ false,
        );
        return toBookingResult(payload);
      });
    },

    async myReservations() {
      await args.ensureLoggedIn();
      const wireArgs: ResyWireMyReservationsInput = {};
      const wrapped = await callTool<
        ResyWireMyReservationsInput,
        { result: ResyWireMyReservationsOutput }
      >(
        deps,
        RESY_TOOL.myReservations,
        wireArgs,
        "my_reservations",
        /* retryable */ true,
      );
      return wrapped.result.map(mapWireReservation);
    },

    async cancel(resyToken) {
      await args.ensureLoggedIn();
      const wireArgs: ResyWireCancelInput = { resy_token: resyToken };
      // Not retryable: cancel may already have succeeded server-side
      // before we saw the transport drop. Surface the error and let the
      // caller reconcile (the route handler updates the DB row regardless).
      await callTool<ResyWireCancelInput, ResyWireCancelSuccess>(
        deps,
        RESY_TOOL.cancel,
        wireArgs,
        "cancel_reservation",
        /* retryable */ false,
      );
    },
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Map the raw book response to our domain shape. The actor's exact schema
 * is under-documented — we pluck the fields we rely on and stash the rest
 * in `raw` so downstream code (activity_log, debugging) can mine it.
 */
function toBookingResult(payload: ResyWireBookSuccess): ResyBookingResult {
  const venueId = payload.venue_id;
  const restaurant = payload.restaurant;
  const date = payload.date;
  const time = payload.time;
  const partySize = payload.party_size;

  return {
    resyToken: payload.resy_token,
    venueId: venueId != null ? String(venueId) : "",
    restaurantName: typeof restaurant === "string" ? restaurant : "",
    date: typeof date === "string" ? date : "",
    time: typeof time === "string" ? time.slice(0, 5) : "",
    partySize: typeof partySize === "number" ? partySize : 0,
    raw: payload as unknown as Record<string, unknown>,
  };
}

/**
 * Small dedicated helper so session methods stay readable. Writes a pending
 * cost_event before the call and marks it `failed` on error.
 *
 * Note: cost_events writes ONE row per session method call. If a call
 * retries internally and succeeds on the second attempt, we don't
 * double-bill here — Apify's invoice is the source of truth and
 * tool_call_log records each attempt for cross-reference.
 */
class CostLogger {
  constructor(private readonly config: ResyMcpConfig) {}

  async bill<T>(
    action: CostAction,
    ctx: ResyCallContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    const costId = await this.preLog(action, ctx);
    try {
      return await fn();
    } catch (err) {
      await this.markFailed(costId);
      throw err;
    }
  }

  private async preLog(
    action: CostAction,
    ctx: ResyCallContext,
  ): Promise<string | null> {
    const { data, error } = await this.config.supabase
      .from("cost_events")
      .insert({
        user_id: this.config.userId ?? null,
        action,
        cost_usd: APIFY_COSTS[action],
        venue_id: ctx.venueId ?? null,
        restaurant_name: ctx.restaurantName ?? null,
        session_id: this.config.sessionId ?? null,
        source: this.config.source,
      })
      .select("id")
      .single();
    if (error) {
      // Don't fail the booking just because logging failed — Apify's
      // invoice is the source of truth for billing reconciliation.
      console.error("[resy-mcp] could not log cost_event", error);
      return null;
    }
    return data.id as string;
  }

  private async markFailed(id: string | null): Promise<void> {
    if (!id) return;
    const { error } = await this.config.supabase
      .from("cost_events")
      .update({ failed: true })
      .eq("id", id);
    if (error) {
      console.error("[resy-mcp] could not mark cost_event failed", error);
    }
  }
}
