import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/lib/auth/session";
import { needsSetup } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Sign in" };
// Queries the database to decide whether an owner account exists yet, so this
// page can never be prerendered — during a container build there is no
// database to ask.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // A fresh install has no account yet — send the first visitor to setup.
  if (await needsSetup()) redirect("/setup");
  if (await getCurrentUser()) redirect("/");

  return (
    <div className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Your personal sales command center.</p>
      <LoginForm className="mt-6" />
    </div>
  );
}
