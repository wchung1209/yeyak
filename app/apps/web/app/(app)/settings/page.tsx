import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SettingsForm } from "@/components/settings/SettingsForm";
import type { PublicProfile } from "@yeyak/types";

export const dynamic = "force-dynamic";

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

  return (
    <div className="space-y-6 px-5 pb-10 pt-6">
      <header>
        <h1 className="font-serif text-2xl">Settings</h1>
        <p className="text-sm text-muted">Profile, Resy connection, and notifications.</p>
      </header>
      {safe && <SettingsForm profile={safe} />}
    </div>
  );
}
