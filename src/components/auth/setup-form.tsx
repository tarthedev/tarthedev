"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/ui/empty";
import { SelectInput, TextInput } from "@/components/ui/field";

/** A short list covers the US retail footprint; any IANA zone also works. */
const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export function SetupForm({
  className,
  defaultTimezone,
}: {
  className?: string;
  defaultTimezone: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    timezone: TIMEZONES.includes(defaultTimezone) ? defaultTimezone : "America/New_York",
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFields({});
    setBusy(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.detail ? `${body.error} ${body.detail}` : (body.error ?? "Could not create the account."));
        setFields(body.fields ?? {});
        return;
      }
      router.replace("/goals?onboarding=1");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={className} noValidate>
      <div className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <TextInput
          label="Name"
          name="name"
          autoComplete="name"
          placeholder="Optional"
          value={form.name}
          onChange={(e) => set("name")(e.target.value)}
        />
        <TextInput
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          required
          error={fields.email}
          value={form.email}
          onChange={(e) => set("email")(e.target.value)}
        />
        <TextInput
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          hint="At least 12 characters, with a letter and a number."
          error={fields.password}
          value={form.password}
          onChange={(e) => set("password")(e.target.value)}
        />
        <SelectInput
          label="Timezone"
          name="timezone"
          hint="Used for period boundaries and the daily target."
          value={form.timezone}
          onChange={(e) => set("timezone")(e.target.value)}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace("_", " ")}
            </option>
          ))}
        </SelectInput>
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          Create account
        </Button>
      </div>
    </form>
  );
}
