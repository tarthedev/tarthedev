import { type MeResponse, ROLE_LABELS } from "@dwrg/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { Button, cx } from "../../components/ui";
import { messageOf } from "../../lib/api";
import { signOut } from "../../lib/auth";
import { APP_VERSION } from "../../lib/config";

export interface NavItem {
  to: "/customers" | "/pricebook" | "/imports" | "/employees" | "/tech" | "/gps-test";
  label: string;
}

/**
 * The frame around every signed-in screen: a navy bar with the app name, who
 * is signed in and Sign out, then the screen's tabs. It respects the iPad's
 * safe areas when the app runs full screen from the home screen.
 */
export function Shell({
  me,
  nav,
  children,
}: {
  me: MeResponse;
  nav: readonly NavItem[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top bg-navy text-paper">
        <div className="safe-x mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
          <Link to="/" className="flex min-h-12 items-center gap-3 text-2xl font-bold">
            <img src="/icon.svg" alt="" className="size-9 rounded-lg" />
            DWRG
          </Link>
          <div className="flex items-center gap-3">
            <p className="text-right leading-tight">
              <span className="block text-base font-semibold">{me.user.name}</span>
              <span className="block text-sm text-paper/75">{ROLE_LABELS[me.user.role]}</span>
            </p>
            <SignOutButton />
          </div>
        </div>
        {nav.length > 0 ? (
          <nav aria-label="Main" className="safe-x mx-auto max-w-6xl">
            <ul className="-mb-px flex gap-1 overflow-x-auto">
              {nav.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="flex min-h-12 items-center rounded-t-xl px-4 text-lg font-semibold whitespace-nowrap text-paper/85 hover:text-paper"
                    activeProps={{ className: "bg-paper text-navy! hover:text-navy" }}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>
      <OfflineBanner />
      <main className="safe-x mx-auto w-full max-w-6xl flex-1 py-6">{children}</main>
      <footer className="safe-x safe-bottom mx-auto w-full max-w-6xl py-4 text-sm text-muted">
        DWRG · version {APP_VERSION}
      </footer>
    </div>
  );
}

function SignOutButton() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="secondary"
        className="border-paper/60 bg-transparent text-paper hover:bg-paper/10"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await signOut(queryClient);
            await navigate({ to: "/login", search: {} });
          } catch (caught) {
            setError(messageOf(caught));
            setBusy(false);
          }
        }}
      >
        Sign out
      </Button>
      {error ? (
        <p role="alert" className="w-full text-right text-base">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** Cellular drops out on the road: say so instead of letting taps fail silently. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return (
    <div
      role="status"
      hidden={online}
      className={cx("bg-orange px-4 py-2 text-center text-lg font-semibold text-navy")}
    >
      No connection. The app will catch up when the signal is back.
    </div>
  );
}
