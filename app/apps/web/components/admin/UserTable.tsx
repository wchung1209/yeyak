"use client";

import { useRouter } from "next/navigation";

interface ProfileRow {
  id: string;
  display_name: string | null;
  role: "admin" | "user";
  created_at: string;
}

export function UserTable({ profiles }: { profiles: ProfileRow[] }) {
  const router = useRouter();

  async function toggleRole(row: ProfileRow) {
    const nextRole = row.role === "admin" ? "user" : "admin";
    if (!confirm(`Change role to ${nextRole}?`)) return;
    await fetch(`/api/admin/users/${row.id}/role`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    });
    router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-ink/5 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Joined</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/5">
          {profiles.map((p) => (
            <tr key={p.id}>
              <td className="px-3 py-2">{p.display_name ?? "—"}</td>
              <td className="px-3 py-2">{p.role}</td>
              <td className="px-3 py-2">{new Date(p.created_at).toLocaleDateString()}</td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={() => toggleRole(p)}
                  className="text-xs text-brass hover:underline"
                >
                  {p.role === "admin" ? "Demote" : "Promote"}
                </button>
              </td>
            </tr>
          ))}
          {profiles.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-center text-muted">
                No users yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
