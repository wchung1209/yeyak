/**
 * Authenticated app shell. Redirects to /login if no session.
 * Renders children + a bottom tab bar.
 *
 * The chat state and the streaming /api/agent fetch live in
 * `<ChatProvider>` here at the layout level. The (app) layout doesn't
 * unmount when the user navigates between /, /settings, /bookings, so
 * an in-flight Yeyak turn keeps streaming through navigation. The
 * provider is also where chat persistence (sessionStorage) lives.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/ui/BottomNav";
import { Splash } from "@/components/ui/Splash";
import { ChatProvider } from "@/lib/chat/ChatContext";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetched here so it's available to both the welcome message in
  // ChatProvider and the onboarding redirect below.
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, onboarding_completed")
    .eq("id", user.id)
    .single();

  // First-run nudge: send users who haven't yet connected (or skipped)
  // through the /onboarding screen. The pathname is forwarded by
  // middleware as an `x-pathname` header so we can avoid redirecting
  // users who are already on /onboarding (which would loop).
  const currentPath = headers().get("x-pathname") ?? "";
  if (
    profile?.onboarding_completed === false &&
    !currentPath.startsWith("/onboarding")
  ) {
    redirect("/onboarding");
  }

  return (
    <ChatProvider displayName={profile?.display_name ?? null}>
      {/*
       * Exact viewport-height flex column: main fills the gap between
       * the (optional) header above and the BottomNav below, with no
       * hardcoded reservation values to drift out of sync. `min-h-0`
       * lets main shrink so its overflow scroll engages instead of
       * pushing the nav off-screen.
       */}
      <div className="flex h-dvh flex-col">
        <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
        <BottomNav />
      </div>
      <Splash />
    </ChatProvider>
  );
}
