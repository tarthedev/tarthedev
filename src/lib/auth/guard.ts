import { redirect } from "next/navigation";

import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/** For server components: sends anonymous visitors to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** True when no account exists yet, which unlocks the setup flow. */
export async function needsSetup(): Promise<boolean> {
  return (await prisma.user.count()) === 0;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "UnauthorizedError";
  }
}

/** For API routes: throws rather than redirecting, so the handler can reply 401. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}
