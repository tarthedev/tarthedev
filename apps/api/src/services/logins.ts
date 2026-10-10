import { randomUUID } from "node:crypto";
import { type AuditContext, account, type Executor, writeAudit } from "@dwrg/db";
import { and, eq } from "drizzle-orm";
import { type Auth, CREDENTIAL_PROVIDER_ID } from "../auth";

/**
 * Email-and-password logins, written the way Better Auth reads them: an
 * `account` row with provider "credential", account_id = the user id, and
 * the password hashed by Better Auth's own hasher (so sign-in can verify it).
 */

/** Hashes with the configured Better Auth instance's password hasher (scrypt by default). */
export async function hashPassword(auth: Auth, password: string): Promise<string> {
  const ctx = await auth.$context;
  return ctx.password.hash(password);
}

/**
 * Creates the credential account for `userId`, or replaces its password when
 * one exists. Audited, with the hash redacted: audit_log never holds secrets.
 * Returns whether the account was created or updated.
 */
export async function setCredentialPassword(
  executor: Executor,
  userId: string,
  passwordHash: string,
  ctx: AuditContext,
): Promise<"created" | "updated"> {
  return executor.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(account)
      .where(
        and(
          eq(account.userId, userId),
          eq(account.providerId, CREDENTIAL_PROVIDER_ID),
          eq(account.accountId, userId),
        ),
      )
      .for("update");

    if (!existing) {
      const [row] = await tx
        .insert(account)
        .values({
          id: randomUUID(),
          accountId: userId,
          providerId: CREDENTIAL_PROVIDER_ID,
          userId,
          password: passwordHash,
        })
        .returning();
      if (!row) throw new Error("insert into account returned no row");
      await writeAudit(tx, {
        ...ctx,
        tableName: "account",
        rowId: row.id,
        action: "insert",
        before: null,
        after: redact(row),
      });
      return "created";
    }

    const [row] = await tx
      .update(account)
      .set({ password: passwordHash })
      .where(eq(account.id, existing.id))
      .returning();
    await writeAudit(tx, {
      ...ctx,
      tableName: "account",
      rowId: existing.id,
      action: "update",
      before: redact(existing),
      after: redact(row ?? existing),
    });
    return "updated";
  });
}

/** An account row safe to log or audit: tokens and the password hash replaced. */
export function redact(row: object): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const key of ["password", "accessToken", "refreshToken", "idToken"]) {
    if (out[key] !== null && out[key] !== undefined) out[key] = "[redacted]";
  }
  return out;
}
