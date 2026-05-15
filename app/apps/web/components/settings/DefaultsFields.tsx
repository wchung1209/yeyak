"use client";

import { Input } from "@/components/ui/Input";

/**
 * The "Yeyak defaults" form section, shared between SettingsForm and
 * the onboarding flow so both write the same shape to `profiles`.
 *
 * Pure controlled form — values come in via props, changes go out via
 * setters. Persistence and validation live in the parent.
 */
export interface DefaultsFieldsValue {
  city: string;
  partySize: string;
  lunchStart: string;
  lunchEnd: string;
  dinnerStart: string;
  dinnerEnd: string;
}

export const EMPTY_DEFAULTS: DefaultsFieldsValue = {
  city: "",
  partySize: "",
  lunchStart: "",
  lunchEnd: "",
  dinnerStart: "",
  dinnerEnd: "",
};

export function DefaultsFields({
  value,
  onChange,
}: {
  value: DefaultsFieldsValue;
  onChange: (next: DefaultsFieldsValue) => void;
}) {
  const set = <K extends keyof DefaultsFieldsValue>(
    key: K,
    next: DefaultsFieldsValue[K],
  ) => onChange({ ...value, [key]: next });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-ink/80">Default city</label>
        <Input
          value={value.city}
          onChange={(e) => set("city", e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-ink/80">
          Default party size (1–10)
        </label>
        <Input
          type="number"
          min={1}
          max={10}
          step={1}
          value={value.partySize}
          onChange={(e) => set("partySize", e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-ink/80">Default lunch window</label>
        <div className="flex items-center gap-2">
          <Input
            type="time"
            value={value.lunchStart}
            onChange={(e) => set("lunchStart", e.target.value)}
          />
          <span className="text-xs text-muted">to</span>
          <Input
            type="time"
            value={value.lunchEnd}
            onChange={(e) => set("lunchEnd", e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-ink/80">Default dinner window</label>
        <div className="flex items-center gap-2">
          <Input
            type="time"
            value={value.dinnerStart}
            onChange={(e) => set("dinnerStart", e.target.value)}
          />
          <span className="text-xs text-muted">to</span>
          <Input
            type="time"
            value={value.dinnerEnd}
            onChange={(e) => set("dinnerEnd", e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

/** "HH:MM:SS" | null → value an <input type="time"> accepts ("HH:MM" or ""). */
export function toTimeInput(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

/** Form input → DB null-or-"HH:MM" (Postgres `time` accepts the short form). */
export function fromTimeInput(s: string): string | null {
  return s.trim().length > 0 ? s : null;
}

/**
 * Validate + map the form value to a DB update payload. Returns either
 * the patch object or an error message; never both.
 */
export function defaultsToProfilePatch(
  value: DefaultsFieldsValue,
):
  | { ok: true; patch: Record<string, string | number | null> }
  | { ok: false; error: string } {
  const partySizeNum = value.partySize.trim().length
    ? Number.parseInt(value.partySize, 10)
    : null;
  if (
    partySizeNum != null &&
    (Number.isNaN(partySizeNum) || partySizeNum < 1 || partySizeNum > 10)
  ) {
    return {
      ok: false,
      error: "Default party size must be a whole number between 1 and 10.",
    };
  }
  return {
    ok: true,
    patch: {
      default_city: value.city.trim() || null,
      default_party_size: partySizeNum,
      default_dinner_start: fromTimeInput(value.dinnerStart),
      default_dinner_end: fromTimeInput(value.dinnerEnd),
      default_lunch_start: fromTimeInput(value.lunchStart),
      default_lunch_end: fromTimeInput(value.lunchEnd),
    },
  };
}
