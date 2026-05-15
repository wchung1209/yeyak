"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { clearChatState } from "@/lib/chat/storage";
import {
  DefaultsFields,
  defaultsToProfilePatch,
  toTimeInput,
  type DefaultsFieldsValue,
} from "./DefaultsFields";
import type { PublicProfile } from "@yeyak/types";

/** Field label + control wrapper so every input has a label above it. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-ink/80">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function SettingsForm({ profile }: { profile: PublicProfile }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [resyEmail, setResyEmail] = useState(profile.resy_email ?? "");
  const [resyPassword, setResyPassword] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(profile.notify_email);
  const [notifySms, setNotifySms] = useState(profile.notify_sms);
  const [phone, setPhone] = useState(profile.phone ?? "");

  const [defaults, setDefaults] = useState<DefaultsFieldsValue>({
    city: profile.default_city ?? "",
    partySize:
      profile.default_party_size != null
        ? String(profile.default_party_size)
        : "",
    lunchStart: toTimeInput(profile.default_lunch_start),
    lunchEnd: toTimeInput(profile.default_lunch_end),
    dinnerStart: toTimeInput(profile.default_dinner_start),
    dinnerEnd: toTimeInput(profile.default_dinner_end),
  });

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    const supabase = createSupabaseBrowserClient();

    const result = defaultsToProfilePatch(defaults);
    if (!result.ok) {
      setSaving(false);
      setMessage(result.error);
      return;
    }

    // Profile fields go through a regular update (RLS gates them).
    const { error: updateErr } = await supabase
      .from("profiles")
      .update({
        display_name: displayName || null,
        resy_email: resyEmail || null,
        notify_email: notifyEmail,
        notify_sms: notifySms,
        phone: phone || null,
        ...result.patch,
      })
      .eq("id", profile.id);
    if (updateErr) {
      setSaving(false);
      setMessage(`Could not save: ${updateErr.message}`);
      return;
    }

    // The Resy password lives in Supabase Vault — write it via the RPC so
    // the plaintext only crosses the wire when it changes, never when we
    // re-read the profile.
    if (resyPassword.trim().length > 0) {
      const { error: rpcErr } = await supabase.rpc("set_resy_password", {
        new_password: resyPassword.trim(),
      });
      if (rpcErr) {
        setSaving(false);
        setMessage(`Could not save Resy password: ${rpcErr.message}`);
        return;
      }
    }

    setSaving(false);
    setMessage("Saved.");
    setResyPassword("");
    router.refresh();
  }

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    // Drop any chat history so the next user doesn't see the previous one's
    // conversation when they sign in on the same browser tab.
    clearChatState();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Field label="Display name">
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Resy connection</h2>
        <Field label="Resy email">
          <Input
            type="email"
            value={resyEmail}
            onChange={(e) => setResyEmail(e.target.value)}
          />
        </Field>
        <Field
          label="Resy password"
          hint={
            profile.has_resy_credentials
              ? "A password is saved. Enter a new one to replace it."
              : "Stored encrypted. Yeyak only uses it to book on your behalf."
          }
        >
          <Input
            type="password"
            value={resyPassword}
            onChange={(e) => setResyPassword(e.target.value)}
            autoComplete="off"
          />
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Yeyak defaults</h2>
        <p className="text-xs text-muted">
          Optional. Yeyak uses these so it doesn&apos;t ask every time. You can
          override any of them in the chat.
        </p>
        <DefaultsFields value={defaults} onChange={setDefaults} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Notifications</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notifyEmail}
            onChange={(e) => setNotifyEmail(e.target.checked)}
          />
          Email notifications
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notifySms}
            onChange={(e) => setNotifySms(e.target.checked)}
          />
          SMS notifications
        </label>
        {notifySms && (
          <Field label="Phone number">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        )}
      </section>

      {message && <p className="text-sm text-muted">{message}</p>}

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
