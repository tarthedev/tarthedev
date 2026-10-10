import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ScreenError } from "../components/errors";
import { navFor } from "../features/shell/nav";
import { Shell } from "../features/shell/Shell";
import { FIELD_ROLES, requireSignIn } from "../lib/auth";

/** The field (iPad) app for techs and installers. Office roles go to their own home. */
export const Route = createFileRoute("/_field")({
  beforeLoad: async ({ context, location }) => ({
    me: await requireSignIn(context.queryClient, location.href, FIELD_ROLES),
  }),
  component: FieldLayout,
  errorComponent: ScreenError,
});

function FieldLayout() {
  const { me } = Route.useRouteContext();
  return (
    <Shell me={me} nav={navFor(me)}>
      <Outlet />
    </Shell>
  );
}
