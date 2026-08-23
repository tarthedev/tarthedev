"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/ui/empty";
import { TextInput } from "@/components/ui/field";

export function LoginForm({ className }: { className?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.detail ? `${body.error} ${body.detail}` : (body.error ?? "Could not sign in."));
        return;
      }
      router.replace("/");
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
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextInput
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          Sign in
        </Button>
      </div>
    </form>
  );
}
