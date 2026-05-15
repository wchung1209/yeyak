/**
 * Translate a raw MCP tool-call result into a validated payload, or throw.
 *
 * The `clearpath/resy-booker` actor doesn't use MCP's transport-level
 * `isError` flag for most logical failures — it returns them embedded in
 * `structuredContent`:
 *
 *   Shape 1 (login, book, cancel):
 *     { success: false, error: "Invalid credentials" }
 *
 *   Shape 2 (search, my_reservations):
 *     { result: [{ error: "..." }] }
 *
 * This helper detects both and throws `ResyMcpError` so callers work with
 * narrow, validated types.
 */
import { ResyMcpError } from "./errors";

/**
 * The MCP SDK's `client.callTool()` return type is a union: the modern
 * `CallToolResult` shape (which carries `structuredContent`) and a legacy
 * `CompatibilityCallToolResult` (which only has `toolResult`). We accept
 * `unknown` and validate at runtime so callers don't have to discriminate
 * before calling us.
 */
interface RawToolResult {
  isError?: boolean;
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
}

/**
 * @param res     The value returned by `client.callTool(...)`.
 * @param label   Human-readable tool name (for error messages).
 *                e.g. "login", "search_restaurants".
 * @returns       The raw `structuredContent`, cast to T. Callers narrow.
 */
export function unwrapStructured<T>(res: unknown, label: string): T {
  if (typeof res !== "object" || res === null) {
    throw new ResyMcpError(
      "unexpected_shape",
      `${label}: tool returned a non-object result`,
    );
  }
  const r = res as RawToolResult;

  if (r.isError) {
    throw new ResyMcpError(
      "transport",
      `${label}: MCP transport reported an error`,
    );
  }

  const sc = r.structuredContent;
  if (sc == null) {
    throw new ResyMcpError(
      "unexpected_shape",
      `${label}: tool returned no structuredContent`,
    );
  }
  if (typeof sc !== "object") {
    throw new ResyMcpError(
      "unexpected_shape",
      `${label}: structuredContent was not an object`,
    );
  }

  const record = sc as Record<string, unknown>;

  // Shape 1: { success: false, error: "..." }
  if (record.success === false) {
    throw new ResyMcpError(
      label === "login" ? "invalid_credentials" : "actor_error",
      String(record.error ?? "unknown error"),
    );
  }

  // Shape 2: { result: [{ error: "..." }] } — sole single-key error object
  if (Array.isArray(record.result) && record.result.length > 0) {
    const first = record.result[0] as Record<string, unknown>;
    if (
      first &&
      typeof first === "object" &&
      "error" in first &&
      Object.keys(first).length === 1
    ) {
      throw new ResyMcpError("actor_error", String(first.error));
    }
  }

  return sc as T;
}
