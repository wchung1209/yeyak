/**
 * /admin/access-requests — admin inbox for prospective-user requests.
 *
 * Server component performs the admin gate (redirects non-admins to /)
 * then defers all interactivity to AccessRequestsClient.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import AccessRequestsClient from "./AccessRequestsClient";

export const dynamic = "force-dynamic";

export default async function AdminAccessRequestsPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/access-requests");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin") redirect("/");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition hover:text-ink"
      >
        <span aria-hidden>←</span> Back to Settings
      </Link>
      <h1 className="mb-2 font-serif text-2xl tracking-tight">Access requests</h1>
      <p className="mb-6 text-sm text-muted">
        Review and approve invitation requests. Approving generates an invite
        URL you'll share with the user manually (auto-email is on the roadmap).
      </p>
      <AccessRequestsClient />
    </main>
  );
}
