"use client";

/**
 * /request-access — public form for prospective users to request access
 * to Yeyak. The submission lands in access_requests with status='pending'
 * for the admin to review at /admin/access-requests.
 *
 * Resend (auto-email) is deferred (task #45); the admin shares the
 * invite link manually after approval.
 */
import { useState } from "react";
import Link from "next/link";

type SubmitState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export default function RequestAccessPage() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          first_name: firstName,
          last_name: lastName,
          display_name: displayName || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message =
          typeof data?.error === "string"
            ? data.error
            : "Could not submit your request. Please try again.";
        setState({ kind: "error", message });
        return;
      }
      // Success regardless of underlying status (already_pending, etc.) —
      // the API intentionally hides which emails are in the system.
      setState({ kind: "success" });
    } catch {
      setState({
        kind: "error",
        message: "Network error. Please try again in a moment.",
      });
    }
  }

  if (state.kind === "success") {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted">
          Thanks. Your request has been recorded. We'll review and reach out by
          email if you're approved.
        </p>
        <Link
          href="/login"
          className="inline-block text-sm text-ink underline hover:text-brass"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-center text-sm text-muted">
        Yeyak is invite-only. Tell us a bit about yourself and we'll be in touch.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <input
          type="text"
          required
          placeholder="First name"
          className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 outline-none focus:border-brass"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          autoComplete="given-name"
          maxLength={80}
        />
        <input
          type="text"
          required
          placeholder="Last name"
          className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 outline-none focus:border-brass"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          autoComplete="family-name"
          maxLength={80}
        />
      </div>
      <input
        type="text"
        placeholder="Display name (optional)"
        className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 outline-none focus:border-brass"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        autoComplete="nickname"
        maxLength={80}
      />
      <input
        type="email"
        required
        placeholder="Email"
        className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 outline-none focus:border-brass"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        maxLength={254}
      />
      {state.kind === "error" && (
        <p className="text-sm text-red-600">{state.message}</p>
      )}
      <button
        type="submit"
        disabled={state.kind === "loading"}
        className="w-full rounded-md bg-ink py-2 text-cream transition hover:bg-ink/90 disabled:opacity-60"
      >
        {state.kind === "loading" ? "Submitting…" : "Request access"}
      </button>
      <p className="pt-2 text-center text-xs text-muted">
        Already have an account?{" "}
        <Link href="/login" className="underline hover:text-brass">
          Sign in
        </Link>
      </p>
    </form>
  );
}
