import { OFFICE_ROLES } from "@dwrg/shared";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ScreenError } from "../components/errors";
import { navFor } from "../features/shell/nav";
import { Shell } from "../features/shell/Shell";
import { requireSignIn } from "../lib/auth";

/** The office app (owner, manager, dispatcher/CSR). Field roles go to their own home. */
export const Route = createFileRoute("/_office")({
  beforeLoad: async ({ context, location }) => ({
    me: await requireSignIn(context.queryClient, location.href, OFFICE_ROLES),
  }),
  component: OfficeLayout,
  errorComponent: ScreenError,
});

function OfficeLayout() {
  const { me } = Route.useRouteContext();
  return (
    <Shell me={me} nav={navFor(me)}>
      <Outlet />
    </Shell>
  );
}
