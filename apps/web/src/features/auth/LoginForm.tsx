import { type FormEvent, useState } from "react";
import { Alert, Button, Field } from "../../components/ui";
import { messageOf } from "../../lib/api";

export interface LoginFormProps {
  /** Signs in; a thrown error's message is shown above the form. */
  onSubmit: (email: string, password: string) => Promise<void>;
}

/** Email and password, big enough to use with a thumb on the iPad. */
export function LoginForm({ onSubmit }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(email, password);
    } catch (caught) {
      setError(messageOf(caught));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        label="Email"
        type="email"
        name="email"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <div>
        <Field
          label="Password"
          type={showPassword ? "text" : "password"}
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label className="mt-2 inline-flex min-h-12 items-center gap-3 text-base">
          <input
            type="checkbox"
            className="size-5 accent-blue"
            checked={showPassword}
            onChange={(e) => setShowPassword(e.target.checked)}
          />
          Show password
        </label>
      </div>
      <Button type="submit" busy={busy} className="w-full">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
