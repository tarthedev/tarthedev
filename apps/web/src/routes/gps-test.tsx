import { createFileRoute } from "@tanstack/react-router";
import { ScreenError } from "../components/errors";
import { GpsTestPage } from "../features/gps/GpsTestPage";
import { navFor } from "../features/shell/nav";
import { Shell } from "../features/shell/Shell";
import { requireSignIn } from "../lib/auth";
import { useTitle } from "../lib/useTitle";

/** The month-1 iPad GPS test, for anyone signed in (techs reach it from their home screen). */
export const Route = createFileRoute("/gps-test")({
  beforeLoad: async ({ context, location }) => ({
    me: await requireSignIn(context.queryClient, location.href),
  }),
  component: GpsTestRoute,
  errorComponent: ScreenError,
});

function GpsTestRoute() {
  const { me } = Route.useRouteContext();
  useTitle("GPS test");
  return (
    <Shell me={me} nav={navFor(me)}>
      <GpsTestPage />
    </Shell>
  );
}
