/**
 * Tool-call audit logger for the Resy MCP client.
 *
 * Wraps every actor tool call (login, search, check_availability, book,
 * my_reservations, cancel) and persists a row to `public.tool_call_log`
 * with the full args + result payload, duration, and any error.
 *
 * Logging failures NEVER block the actual tool call — we always swallow
 * persistence errors and just `console.error` them. The tool call is the
 * source of truth; logging is observability.
 *
 * Sensitive args are redacted: `login.password` is replaced with the
 * literal string "[REDACTED]" before insertion. Oversized payloads are
 * truncated at ~50KB so a runaway result doesn't bloat the table.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CostSource } from "@yeyak/types";
import { ResyMcpError } from "./errors";

export interface ToolLogConfig {
  supabase: SupabaseClient;
  source: CostSource;
  userId?: string | null;
  sessionId?: string;
}

const MAX_JSON_BYTES = 50_000;

export class ToolCallLogger {
  constructor(private readonly config: ToolLogConfig) {}

  /**
   * Wrap a tool call. Pre-logs args, then post-logs result/error/duration.
   * Whatever `fn` throws or returns is returned/thrown verbatim.
   */
  async log<T>(
    toolName: string,
    args: object,
    fn: () => Promise<T>,
  ): Promise<T> {
    const id = await this.preLog(toolName, args);
    const start = Date.now();
    try {
      const result = await fn();
      await this.postLog(id, {
        result: truncateForLog(result),
        durationMs: Date.now() - start,
      });
      return result;
    } catch (err) {
      const { kind, message } = describeError(err);
      await this.postLog(id, {
        errorKind: kind,
        errorMessage: message,
        durationMs: Date.now() - start,
      });
      throw err;
    }
  }

  private async preLog(toolName: string, args: object): Promise<string | null> {
    const safeArgs = redactArgs(toolName, args);
    const { data, error } = await this.config.supabase
      .from("tool_call_log")
      .insert({
        user_id: this.config.userId ?? null,
        source: this.config.source,
        session_id: this.config.sessionId ?? null,
        tool_name: toolName,
        args: truncateForLog(safeArgs),
      })
      .select("id")
      .single();
    if (error) {
      console.error("[tool-log] preLog failed", error);
      return null;
    }
    return data.id as string;
  }

  private async postLog(
    id: string | null,
    update: {
      result?: unknown;
      errorKind?: string;
      errorMessage?: string;
      durationMs: number;
    },
  ): Promise<void> {
    if (!id) return;
    const patch: Record<string, unknown> = { duration_ms: update.durationMs };
    if (update.result !== undefined) patch.result = update.result;
    if (update.errorKind) patch.error_kind = update.errorKind;
    if (update.errorMessage) patch.error_message = update.errorMessage;

    const { error } = await this.config.supabase
      .from("tool_call_log")
      .update(patch)
      .eq("id", id);
    if (error) {
      console.error("[tool-log] postLog failed", error);
    }
  }
}

function redactArgs(toolName: string, args: object): object {
  if (toolName === "login" && "password" in args) {
    return { ...args, password: "[REDACTED]" };
  }
  return args;
}

function truncateForLog(value: unknown): unknown {
  let str: string;
  try {
    str = JSON.stringify(value);
  } catch {
    return { _unserializable: true };
  }
  if (str.length <= MAX_JSON_BYTES) return value;
  return {
    _truncated: true,
    _bytes: str.length,
    preview: str.slice(0, 1000),
  };
}

function describeError(err: unknown): { kind: string; message: string } {
  if (err instanceof ResyMcpError) {
    return { kind: err.kind, message: err.message };
  }
  if (err instanceof Error) {
    return { kind: "unknown", message: err.message };
  }
  return { kind: "unknown", message: String(err) };
}
