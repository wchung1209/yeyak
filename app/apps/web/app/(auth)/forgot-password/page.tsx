"use client";

/**
 * /forgot-password — public page. Uses Supabase Auth's built-in
 * resetPasswordForEmail flow, which sends a recovery email via
 * Supabase's managed SMTP. No Resend dependency.
 *
 * The redirect target lands users on /auth/reset-password where they
 * pick a new password.
 *
 * We always show the same success message regardless of whether the
 * email exists, to avoid leaking which addresses are in the system.
 */
import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done" }
  | { kind: "error"; message: string };

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "loading" });
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      // Treat most errors as success-looking (don't leak existence). Only
      // surface a real error for malformed input that Supabase will reject
      // regardless (e.g. "Email rate limit exceeded").
      if (/rate limit/i.test(error.message)) {
        setState({
          kind: "error",
          message: "Too many attempts. Please wait a few minutes and try again.",
        });
        return;
      }
      // Fall through to "done" — same UX as success.
    }
    setState({ kind: "done" });
  }

  if (state.kind === "done") {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted">
          If an account exists for that email, we've sent a password reset
          link. Check your inbox (and spam folder).
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
        Enter the email tied to your Yeyak account and we'll send you a reset
        link.
      </p>
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
        {state.kind === "loading" ? "Sending…" : "Send reset link"}
      </button>
      <p className="pt-2 text-center text-xs text-muted">
        Remembered it?{" "}
        <Link href="/login" className="underline hover:text-brass">
          Sign in
        </Link>
      </p>
    </form>
  );
}
