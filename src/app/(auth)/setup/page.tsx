import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { SetupForm } from "@/components/auth/setup-form";
import { needsSetup } from "@/lib/auth/guard";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Set up" };
// Queries the database to decide whether an owner account exists yet, so this
// page can never be prerendered — during a container build there is no
// database to ask.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const fresh = await needsSetup();
  // Once an owner exists this page is closed unless registration is left open.
  if (!fresh && !env().ALLOW_REGISTRATION) redirect("/login");

  return (
    <div className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight">
        {fresh ? "Create your account" : "Add an account"}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {fresh
          ? "One account owns this dashboard. Everything stays on your own server."
          : "Registration is currently open on this instance."}
      </p>
      <SetupForm className="mt-6" defaultTimezone={env().TIMEZONE} />
    </div>
  );
}
