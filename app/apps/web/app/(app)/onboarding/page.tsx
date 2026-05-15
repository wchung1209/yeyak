/**
 * One-time onboarding screen — shown to users with
 * `profiles.onboarding_completed = false`. The (app)/layout redirects
 * them here automatically; both "Connect & continue" and "Skip for now"
 * flip the flag, so the user only sees this once.
 */
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  return (
    <div className="space-y-6 px-5 pb-10 pt-8">
      <header className="space-y-2">
        <h1 className="font-serif text-3xl">Welcome to Yeyak</h1>
        <p className="text-sm text-muted">
          Yeyak is your reservationist — it discovers restaurants, watches for
          openings, and books on your behalf. Connect your Resy account to
          let Yeyak hold the table.
        </p>
      </header>
      <OnboardingForm userId={user.id} />
    </div>
  );
}
