import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { NotFound, ScreenError } from "../components/errors";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: (props) => (
    <main className="safe-x safe-top">
      <ScreenError {...props} />
    </main>
  ),
  notFoundComponent: NotFound,
});
