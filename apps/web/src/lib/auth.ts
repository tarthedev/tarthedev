import {
  type MeResponse,
  meResponseSchema,
  OFFICE_ROLES,
  PEOPLE_ADMIN_ROLES,
  type Role,
} from "@dwrg/shared";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { ApiError, anyBody, api } from "./api";

/**
 * Who is signed in. The session lives in an HttpOnly cookie the page can't
 * read, so GET /api/me is the only way to know; null means signed out.
 */
export const meQueryKey = ["me"] as const;

export const meQueryOptions = queryOptions({
  queryKey: meQueryKey,
  queryFn: async (): Promise<MeResponse | null> => {
    try {
      return await api("/api/me", { schema: meResponseSchema });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  staleTime: 5 * 60_000,
});

export const FIELD_ROLES = ["tech", "installer"] as const satisfies readonly Role[];

export const isOffice = (role: Role) => (OFFICE_ROLES as readonly Role[]).includes(role);
export const isPeopleAdmin = (role: Role) => (PEOPLE_ADMIN_ROLES as readonly Role[]).includes(role);

/** Where each role starts: the office app or the field (iPad) app. */
export function homePathFor(role: Role): "/customers" | "/tech" {
  return isOffice(role) ? "/customers" : "/tech";
}

/** A same-app path to return to after signing in; anything else is dropped. */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return undefined;
  if (value === "/login" || value.startsWith("/login?")) return undefined;
  return value;
}

/** Signs in with email and password; Better Auth sets the session cookie. */
export async function signIn(queryClient: QueryClient, email: string, password: string) {
  try {
    await api("/api/auth/sign-in/email", {
      method: "POST",
      json: { email: email.trim(), password },
      schema: anyBody,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new ApiError(401, error.code, "That email and password don't match a login.");
    }
    throw error;
  }
  queryClient.removeQueries();
  const me = await queryClient.fetchQuery(meQueryOptions);
  if (!me) throw new ApiError(401, "unauthorized", "Signing in didn't stick. Try again.");
  return me;
}

/** Signs out and forgets everything cached for this person. */
export async function signOut(queryClient: QueryClient) {
  try {
    await api("/api/auth/sign-out", { method: "POST", json: {}, schema: anyBody });
  } finally {
    queryClient.clear();
    queryClient.setQueryData(meQueryKey, null);
  }
}

/**
 * Route guard (beforeLoad): the signed-in person, or a redirect to /login
 * that comes back to `href` afterwards. With `roles`, anyone else goes to
 * their own home screen.
 */
export async function requireSignIn(
  queryClient: QueryClient,
  href: string,
  roles?: readonly Role[],
): Promise<MeResponse> {
  const me = await queryClient.ensureQueryData(meQueryOptions);
  if (!me) throw redirect({ to: "/login", search: { redirect: safeRedirect(href) } });
  if (roles && !roles.includes(me.user.role)) throw redirect({ to: homePathFor(me.user.role) });
  return me;
}
