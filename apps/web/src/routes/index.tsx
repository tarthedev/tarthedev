import { createFileRoute, redirect } from "@tanstack/react-router";
import { homePathFor, requireSignIn } from "../lib/auth";

/** The start screen: sign in, or go to this role's home. */
export const Route = createFileRoute("/")({
  beforeLoad: async ({ context, location }) => {
    const me = await requireSignIn(context.queryClient, location.href);
    throw redirect({ to: homePathFor(me.user.role) });
  },
});
