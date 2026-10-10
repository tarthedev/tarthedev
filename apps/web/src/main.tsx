import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Loading } from "./components/ui";
import { ApiError, isUnauthorized } from "./lib/api";
import { meQueryKey, safeRedirect } from "./lib/auth";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

// A tab left open across a deploy can ask for a chunk that no longer exists:
// reload to get the new build instead of showing a broken screen.
window.addEventListener("vite:preloadError", () => {
  window.location.reload();
});

/** When the session ends mid-use (expired, turned off), go back to sign in. */
function onSignedOut(error: unknown, key?: readonly unknown[]) {
  if (!isUnauthorized(error) || key?.[0] === meQueryKey[0]) return;
  queryClient.setQueryData(meQueryKey, null);
  const here = router.state.location.href;
  void router.navigate({ to: "/login", search: { redirect: safeRedirect(here) } });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error, query) => onSignedOut(error, query.queryKey) }),
  mutationCache: new MutationCache({ onError: (error) => onSignedOut(error) }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retry outages, not answers: a 4xx won't change by asking again.
      retry: (failures, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2,
    },
    mutations: { retry: false },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  defaultPendingComponent: () => <Loading />,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
