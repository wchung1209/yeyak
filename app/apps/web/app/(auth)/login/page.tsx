"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// useSearchParams() causes Next.js to bail out of static rendering. In
// Next 14 the consumer of that hook MUST sit inside a <Suspense>
// boundary or `next build` errors with "missing-suspense-with-csr-bailout".
// We split the form into its own component and wrap it below.
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFormFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFormFallback() {
  return (
    <div className="space-y-4">
      <p className="text-center text-sm text-muted">Welcome back. Sign in to continue.</p>
      <div className="h-10 w-full rounded-md border border-ink/10 bg-white" />
      <div className="h-10 w-full rounded-md border border-ink/10 bg-white" />
      <div className="h-10 w-full rounded-md bg-ink/60" />
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(nextPath);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-center text-sm text-muted">Welcome back. Sign in to continue.</p>
      <input
        type="email"
        required
        placeholder="Email"
        className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 outline-none focus:border-brass"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
      <input
        type="password"
        required
        placeholder="Password"
        className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 outline-none focus:border-brass"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-ink py-2 text-cream transition hover:bg-ink/90 disabled:opacity-60"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
      <div className="pt-2 text-center text-xs text-muted">
        <Link href="/forgot-password" className="underline hover:text-brass">
          Forgot password?
        </Link>
      </div>
      <p className="pt-1 text-center text-xs text-muted">
        Don't have an account?{" "}
        <Link href="/request-access" className="underline hover:text-brass">
          Request access
        </Link>
      </p>
    </form>
  );
}
