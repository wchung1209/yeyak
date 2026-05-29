"use client";

/**
 * /reset-password — landing page from the Supabase password recovery
 * email. Supabase's JS client automatically picks up the recovery
 * token from the URL hash (#access_token=...&type=recovery) and
 * establishes a temporary recovery session. From that session the
 * user can call updateUser({ password }) to set a new password.
 *
 * We listen for the PASSWORD_RECOVERY auth event (most reliable
 * signal that the recovery session is live) and also fall back to
 * getSession() in case the event fired before we mounted.
 *
 * This route is in PUBLIC_PATHS so middleware doesn't redirect to
 * /login before Supabase can set the recovery session.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Phase =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "submitting" }
  | { kind: "done" }
  | { kind: "expired" }
  | { kind: "error"; message: string };

const MIN_PASSWORD_LENGTH = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    let resolved = false;
    const finish = (ready: boolean) => {
      if (resolved) return;
      resolved = true;
      setPhase(ready ? { kind: "ready" } : { kind: "expired" });
    };

    // Path A: event fires after the client parses the URL hash.
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") finish(true);
    });

    // Path B: the client may have already established the session by
    // the time we subscribe — check synchronously and treat any active
    // session as a valid recovery session.
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) finish(true);
    })();

    // If neither path resolves within a short window, the user likely
    // arrived without a valid recovery link.
    const timer = setTimeout(() => finish(false), 1500);

    return () => {
      subscription.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setPhase({
        kind: "error",
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
      return;
    }
    if (password !== confirm) {
      setPhase({ kind: "error", message: "Passwords don't match." });
      return;
    }
    setPhase({ kind: "submitting" });

    const supabase: SupabaseClient = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setPhase({ kind: "error", message: error.message });
      return;
    }
    setPhase({ kind: "done" });
    // Brief pause so the success copy registers, then send them in.
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 800);
  }

  if (phase.kind === "checking") {
    return <p className="text-center text-sm text-muted">Verifying reset link…</p>;
  }

  if (phase.kind === "expired") {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-red-600">
          This reset link is invalid or has expired.
        </p>
        <Link
          href="/forgot-password"
          className="inline-block text-sm text-ink underline hover:text-brass"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  if (phase.kind === "done") {
    return (
      <p className="text-center text-sm text-muted">
        Password updated. Redirecting…
      </p>
    );
  }

  const submitting = phase.kind === "submitting";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-center text-sm text-muted">
        Choose a new password to finish signing in.
      </p>
      <input
        type="password"
        required
        placeholder="New password"
        className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 outline-none focus:border-brass"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
      />
      <input
        type="password"
        required
        placeholder="Confirm new password"
        className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 outline-none focus:border-brass"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
      />
      {phase.kind === "error" && (
        <p className="text-sm text-red-600">{phase.message}</p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-ink py-2 text-cream transition hover:bg-ink/90 disabled:opacity-60"
      >
        {submitting ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
