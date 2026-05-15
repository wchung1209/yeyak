/**
 * Admin-only shell. Enforces `role = 'admin'` server-side.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") redirect("/");

  return (
    <div className="min-h-dvh bg-cream">
      <header className="border-b border-ink/10 bg-white px-5 py-3">
        <nav className="flex items-center justify-between text-sm">
          <Link href="/admin" className="font-serif text-lg">
            Yeyak · Admin
          </Link>
          <div className="flex gap-4">
            <Link href="/admin" className="text-muted hover:text-ink">Dashboard</Link>
            <Link href="/admin/users" className="text-muted hover:text-ink">Users</Link>
            <Link href="/" className="text-muted hover:text-ink">← App</Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-6">{children}</main>
    </div>
  );
}
