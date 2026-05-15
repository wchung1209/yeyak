/**
 * Typed errors thrown by the Resy MCP client. Callers can switch on `kind`
 * to decide whether to surface to the user, retry, or ask for re-login.
 */

export type ResyErrorKind =
  /** Actor replied {success: false, error: "..."} or {result: [{error}]}. */
  | "actor_error"
  /** `login` returned success=false. Usually: bad password or Resy soft-block. */
  | "invalid_credentials"
  /** Tool returned a shape we didn't expect. Likely an actor version drift. */
  | "unexpected_shape"
  /** MCP transport-level failure (connection, timeout, 5xx). */
  | "transport";

export class ResyMcpError extends Error {
  readonly kind: ResyErrorKind;
  constructor(kind: ResyErrorKind, message: string) {
    super(message);
    this.name = "ResyMcpError";
    this.kind = kind;
  }
}

/**
 * True iff the error looks like a transport / session-loss issue worth
 * retrying once. Matches Apify's "Session not found" JSON-RPC error plus
 * the usual Node.js network error messages.
 *
 * Conservative on purpose: only fires on errors that strongly imply a
 * recoverable transport state. Wire-format mismatches, actor errors, and
 * invalid credentials should NOT bounce through here.
 */
export function isTransportLikeError(err: unknown): boolean {
  if (err instanceof ResyMcpError) {
    return err.kind === "transport";
  }
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("session not found") ||
    msg.includes("streamable http") ||
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("network error") ||
    msg.includes("request timed out")
  );
}
