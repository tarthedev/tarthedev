import { account, type Database, user } from "@dwrg/db";
import type { Role } from "@dwrg/shared";
import { and, asc, eq, like } from "drizzle-orm";
import { type Auth, CREDENTIAL_PROVIDER_ID } from "../auth";
import { setCredentialPassword } from "./logins";

/**
 * Email-and-password logins for the seeded demo users (`pnpm --filter
 * @dwrg/api seed-auth`). Every user whose email is at the demo domain gets a
 * credential account with the same password, hashed by the running Better
 * Auth configuration so sign-in verifies it. Re-running is safe: a login whose
 * password already matches is left alone (no write, no audit row).
 */

export const DEMO_PASSWORD = "demo-password-123";

export const DEMO_LOGINS_REASON = "Demo logins for the seeded demo users (seed-auth)";

export interface DemoLogin {
  userId: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  result: "created" | "updated" | "unchanged";
}

export interface SeedDemoLoginsOptions {
  /** Users whose email ends in `@<emailDomain>` get a login. */
  emailDomain: string;
  password?: string;
}

/** Ordered owner, manager, dispatcher/CSR, tech, installer, then by email. */
const ROLE_ORDER: Record<Role, number> = {
  owner: 0,
  manager: 1,
  dispatcher_csr: 2,
  tech: 3,
  installer: 4,
};

export async function seedDemoLogins(
  db: Database,
  auth: Auth,
  { emailDomain, password = DEMO_PASSWORD }: SeedDemoLoginsOptions,
): Promise<DemoLogin[]> {
  if (!/^[a-z0-9.-]+\.[a-z]+$/i.test(emailDomain)) {
    throw new Error(`Not an email domain: ${emailDomain}`);
  }
  const ctx = await auth.$context;
  const users = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
    })
    .from(user)
    .where(like(user.email, `%@${emailDomain}`))
    .orderBy(asc(user.email));

  const out: DemoLogin[] = [];
  for (const u of users) {
    const [existing] = await db
      .select({ password: account.password })
      .from(account)
      .where(
        and(
          eq(account.userId, u.id),
          eq(account.providerId, CREDENTIAL_PROVIDER_ID),
          eq(account.accountId, u.id),
        ),
      );
    const matches =
      typeof existing?.password === "string" &&
      (await ctx.password.verify({ password, hash: existing.password }).catch(() => false));
    const result = matches
      ? ("unchanged" as const)
      : await setCredentialPassword(db, u.id, await ctx.password.hash(password), {
          userId: null,
          reason: DEMO_LOGINS_REASON,
        });
    out.push({
      userId: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      result,
    });
  }
  return out.sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.email.localeCompare(b.email),
  );
}
