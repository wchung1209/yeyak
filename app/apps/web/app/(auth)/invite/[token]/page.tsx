"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function InviteAcceptPage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/invite?token=${encodeURIComponent(params.token)}`);
      if (!res.ok) {
        setError("This invite is invalid or has expired.");
        setReady(true);
        return;
      }
      const data = (await res.json()) as { email: string };
      setEmail(data.email);
      setReady(true);
    })();
  }, [params.token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }
    const res = await fetch("/api/invite/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: params.token }),
    });
    setLoading(false);
    if (!res.ok) {
      setError("Could not finalize invite. Please contact an admin.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  if (!ready) return <p className="text-center text-sm text-muted">Loading…</p>;
  if (error && !email) return <p className="text-center text-sm text-red-600">{error}</p>;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-center text-sm text-muted">
        You've been invited. Create your account to continue.
      </p>
      <input
        type="email"
        value={email ?? ""}
        disabled
        className="w-full rounded-md border border-ink/10 bg-ink/5 px-3 py-2"
      />
      <input
        type="text"
        placeholder="Display name"
        className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 outline-none focus:border-brass"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="Choose a password"
        className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 outline-none focus:border-brass"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={8}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-ink py-2 text-cream disabled:opacity-60"
      >
        {loading ? "Creating account…" : "Accept invite"}
      </button>
    </form>
  );
}
