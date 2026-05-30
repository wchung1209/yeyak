import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SettingsForm } from "@/components/settings/SettingsForm";
import type { PublicProfile } from "@yeyak/types";

export const dynamic = "force-dynamic";

// Admin sub-menu surfaces. The section is rendered only when the
// signed-in profile holds role='admin'. The DB-layer trigger
// enforce_admin_email_allowlist enforces who can hold that role.
const ADMIN_LINKS: { href: string; label: string; description: string }[] = [
  {
    href: "/admin/access-requests",
    label: "Access requests",
    description: "Review and approve invitation requests.",
  },
];

export default async function SettingsPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, display_name, role, resy_email, resy_password_secret_id, notify_email, notify_sms, phone, default_city, default_party_size, default_dinner_start, default_dinner_end, default_lunch_start, default_lunch_end, timezone, onboarding_completed, created_at",
    )
    .eq("id", user!.id)
    .single();

  // Strip the vault secret id before sending to the client; surface only a
  // boolean presence flag.
  const safe: PublicProfile | null = profile
    ? {
        id: profile.id,
        display_name: profile.display_name,
        role: profile.role,
        resy_email: profile.resy_email,
        notify_email: profile.notify_email,
        notify_sms: profile.notify_sms,
        phone: profile.phone,
        default_city: profile.default_city,
        default_party_size: profile.default_party_size,
        default_dinner_start: profile.default_dinner_start,
        default_dinner_end: profile.default_dinner_end,
        default_lunch_start: profile.default_lunch_start,
        default_lunch_end: profile.default_lunch_end,
        timezone: profile.timezone,
        onboarding_completed: profile.onboarding_completed,
        created_at: profile.created_at,
        has_resy_credentials: Boolean(
          profile.resy_password_secret_id && profile.resy_email,
        ),
      }
    : null;

  const isAdmin = safe?.role === "admin";

  return (
    <div className="space-y-6 px-5 pb-10 pt-6">
      <header>
        <h1 className="font-serif text-2xl">Settings</h1>
        <p className="text-sm text-muted">Profile, Resy connection, and notifications.</p>
      </header>
      {safe && <SettingsForm profile={safe} />}
      {isAdmin && (
        <section
          aria-labelledby="admin-section-heading"
          className="space-y-3 rounded-lg border border-ink/10 bg-cream/30 p-4"
        >
          <div>
            <h2 id="admin-section-heading" className="font-serif text-lg">
              Admin
            </h2>
            <p className="text-xs text-muted">
              Restricted controls. Visible only to allowlisted admins.
            </p>
          </div>
          <ul className="space-y-2">
            {ADMIN_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex items-center justify-between rounded-md border border-ink/10 bg-white px-3 py-2 text-sm transition hover:border-brass hover:bg-cream/50"
                >
                  <span>
                    <span className="font-medium text-ink">{link.label}</span>
                    <span className="ml-2 text-xs text-muted">
                      {link.description}
                    </span>
                  </span>
                  <span aria-hidden className="text-muted">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
