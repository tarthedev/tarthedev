import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { LoginForm } from "../features/auth/LoginForm";
import { homePathFor, meQueryOptions, safeRedirect, signIn } from "../lib/auth";
import { useTitle } from "../lib/useTitle";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const target = safeRedirect(search.redirect);
    return target ? { redirect: target } : {};
  },
  beforeLoad: async ({ context }) => {
    // Already signed in: straight to work.
    const me = await context.queryClient.ensureQueryData(meQueryOptions).catch(() => null);
    if (me) throw redirect({ to: homePathFor(me.user.role) });
  },
  component: LoginPage,
});

function LoginPage() {
  const { queryClient } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate();
  useTitle("Sign in");

  return (
    <main className="safe-x safe-top flex min-h-dvh items-center justify-center py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <img src="/icon.svg" alt="" className="mx-auto mb-4 size-20" />
          <h1 className="text-3xl font-bold text-navy">DWRG Heating &amp; Cooling</h1>
          <p className="mt-1 text-lg text-muted">Sign in with your work email.</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6">
          <LoginForm
            onSubmit={async (email, password) => {
              const me = await signIn(queryClient, email, password);
              const home = homePathFor(me.user.role);
              await navigate({ href: search.redirect ?? home, replace: true });
            }}
          />
        </div>
        <p className="mt-6 text-center text-base text-muted">
          No login yet, or forgot your password? Ask an owner or manager.
        </p>
      </div>
    </main>
  );
}
