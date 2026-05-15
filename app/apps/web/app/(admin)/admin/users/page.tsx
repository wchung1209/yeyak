import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { UserTable } from "@/components/admin/UserTable";
import { InviteForm } from "@/components/admin/InviteForm";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const svc = createSupabaseServiceClient();

  const [{ data: profiles }, { data: invites }] = await Promise.all([
    svc.from("profiles").select("*").order("created_at", { ascending: false }),
    svc.from("invites").select("*").eq("accepted", false).order("created_at", { ascending: false }),
  ]);

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-2xl">Users</h1>
          <p className="text-sm text-muted">Manage access and send invites.</p>
        </div>
      </header>

      <section>
        <h2 className="mb-3 font-serif text-lg">Invite new user</h2>
        <InviteForm />
      </section>

      <section>
        <h2 className="mb-3 font-serif text-lg">Pending invites</h2>
        {invites && invites.length > 0 ? (
          <ul className="divide-y divide-ink/5 rounded-md border border-ink/10 bg-white text-sm">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between px-3 py-2">
                <span>{i.email}</span>
                <span className="text-xs text-muted">
                  expires {new Date(i.expires_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No pending invites.</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-serif text-lg">All users</h2>
        <UserTable profiles={profiles ?? []} />
      </section>
    </div>
  );
}
