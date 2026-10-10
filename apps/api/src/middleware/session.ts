import { ROLE_LABELS, ROLES, type Role } from "@dwrg/shared";
import type { MiddlewareHandler } from "hono";
import type { Auth } from "../auth";
import type { AuthedEnv, SessionUser } from "../context";
import { forbidden, unauthorized } from "../errors";

/**
 * requireSession: the request must carry a valid Better Auth session cookie
 * for an active login. Sets `user` and `session` on the context; anything
 * else is a 401. When Better Auth extends the session (once a day of use), the
 * refreshed cookie is passed on to the response.
 */
export function requireSession(auth: Auth): MiddlewareHandler<AuthedEnv> {
  return async (c, next) => {
    const { headers, response } = await auth.api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    if (!response) throw unauthorized();

    const raw = response.user as typeof response.user & { role?: unknown; active?: unknown };
    if (raw.active === false)
      throw unauthorized("This login is turned off. Ask an owner or manager.");
    if (!isRole(raw.role)) throw forbidden("This login has no role. Ask an owner or manager.");

    const user: SessionUser = {
      id: raw.id,
      name: raw.name,
      email: raw.email,
      role: raw.role,
      image: raw.image ?? null,
    };
    c.set("user", user);
    c.set("session", { id: response.session.id, expiresAt: new Date(response.session.expiresAt) });
    c.get("log").debug("session", { userId: user.id, role: user.role });

    await next();

    for (const cookie of headers?.getSetCookie() ?? [])
      c.header("Set-Cookie", cookie, { append: true });
  };
}

/**
 * requireRole(...roles): after requireSession, only these roles get through;
 * everyone else gets a 403. Every endpoint states its roles explicitly.
 */
export function requireRole(...roles: readonly Role[]): MiddlewareHandler<AuthedEnv> {
  if (roles.length === 0) throw new Error("requireRole needs at least one role");
  const allowed = new Set<Role>(roles);
  return async (c, next) => {
    const user = c.get("user");
    if (!user) throw unauthorized();
    if (!allowed.has(user.role)) {
      c.get("log").info("role denied", { userId: user.id, role: user.role, path: c.req.path });
      throw forbidden(`${ROLE_LABELS[user.role]} logins can't use this.`);
    }
    await next();
  };
}

/**
 * auditContext: after requireSession, gives handlers `c.get("audit")`, which
 * builds the AuditContext the @dwrg/db audit helpers take (CLAUDE.md rule 4):
 *
 *   await insertWithAudit(tx, table, values, c.get("audit").ctx("New hire"));
 *
 * A write without a reason is a programming error, so ctx() refuses one.
 */
export function auditContext(): MiddlewareHandler<AuthedEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) throw unauthorized();
    const requestId = c.get("requestId");
    c.set("audit", {
      userId: user.id,
      requestId,
      ctx: (reason: string) => {
        const trimmed = reason.trim();
        if (!trimmed) throw new Error("An audited change needs a reason");
        return { userId: user.id, reason: trimmed };
      },
    });
    await next();
  };
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
