"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  DefaultsFields,
  EMPTY_DEFAULTS,
  defaultsToProfilePatch,
  type DefaultsFieldsValue,
} from "@/components/settings/DefaultsFields";

/**
 * One-time onboarding form. Two paths out:
 *
 *   • "Connect & continue" — saves Resy email + password (via the
 *     `set_resy_password` Vault RPC), saves any defaults the user
 *     filled in, sets `onboarding_completed = true`, navigates to /.
 *   • "Skip for now" — sets `onboarding_completed = true` only and
 *     navigates to /. The user can return to Settings any time to
 *     enter Resy credentials.
 *
 * Defaults are kept under a "Customize defaults" disclosure so the
 * core path stays minimal — most users will just enter Resy creds and
 * continue.
 */
export function OnboardingForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [resyEmail, setResyEmail] = useState("");
  const [resyPassword, setResyPassword] = useState("");
  const [defaults, setDefaults] = useState<DefaultsFieldsValue>(EMPTY_DEFAULTS);
  const [showDefaults, setShowDefaults] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function completeOnboarding(opts: { skipResy: boolean }) {
    setSaving(true);
    setMessage(null);
    const supabase = createSupabaseBrowserClient();

    // If the user is connecting Resy, both fields are required.
    if (
      !opts.skipResy &&
      (resyEmail.trim().length === 0 || resyPassword.trim().length === 0)
    ) {
      setSaving(false);
      setMessage("Enter both your Resy email and password, or click Skip.");
      return;
    }

    // Map the optional defaults block to a profile patch. Empty fields
    // pass through as null — they remain unset until the user edits them.
    const defaultsResult = defaultsToProfilePatch(defaults);
    if (!defaultsResult.ok) {
      setSaving(false);
      setMessage(defaultsResult.error);
      return;
    }

    const profilePatch: Record<string, unknown> = {
      ...defaultsResult.patch,
      onboarding_completed: true,
    };
    if (!opts.skipResy) {
      profilePatch.resy_email = resyEmail.trim();
    }

    const { error: updateErr } = await supabase
      .from("profiles")
      .update(profilePatch)
      .eq("id", userId);
    if (updateErr) {
      setSaving(false);
      setMessage(`Could not save: ${updateErr.message}`);
      return;
    }

    if (!opts.skipResy) {
      const { error: rpcErr } = await supabase.rpc("set_resy_password", {
        new_password: resyPassword.trim(),
      });
      if (rpcErr) {
        setSaving(false);
        setMessage(`Could not save Resy password: ${rpcErr.message}`);
        return;
      }
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Connect Resy</h2>
        <div className="space-y-1">
          <label className="text-xs font-medium text-ink/80">Resy email</label>
          <Input
            type="email"
            value={resyEmail}
            onChange={(e) => setResyEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-ink/80">Resy password</label>
          <Input
            type="password"
            value={resyPassword}
            onChange={(e) => setResyPassword(e.target.value)}
            autoComplete="off"
          />
          <p className="text-xs text-muted">
            Stored encrypted. Yeyak only uses it to book on your behalf. You can
            enter your Resy credentials later in Settings.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <button
          type="button"
          onClick={() => setShowDefaults((v) => !v)}
          className="text-sm font-medium text-ink/80 underline-offset-2 hover:underline"
          aria-expanded={showDefaults}
        >
          {showDefaults ? "Hide" : "Customize"} defaults (optional)
        </button>
        {showDefaults && (
          <div className="space-y-2">
            <p className="text-xs text-muted">
              Tell Yeyak how you usually dine and it&apos;ll stop asking the same
              questions every conversation.
            </p>
            <DefaultsFields value={defaults} onChange={setDefaults} />
          </div>
        )}
      </section>

      {message && <p className="text-sm text-muted">{message}</p>}

      <div className="flex items-center gap-2">
        <Button onClick={() => completeOnboarding({ skipResy: false })} disabled={saving}>
          {saving ? "Saving…" : "Connect & continue"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => completeOnboarding({ skipResy: true })}
          disabled={saving}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}
