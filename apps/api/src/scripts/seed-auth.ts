import { createDb, loadRootEnv } from "@dwrg/db";
import { DEMO_EMAIL_DOMAIN } from "@dwrg/db/demo";
import { ROLE_LABELS } from "@dwrg/shared";
import { createAuth } from "../auth";
import { InvalidEnvError, parseEnv } from "../env";
import { silentLogger } from "../logger";
import { DEMO_PASSWORD, seedDemoLogins } from "../services/demo-logins";

/**
 * pnpm --filter @dwrg/api seed-auth
 *
 * Gives every seeded demo user (pnpm db:seed) an email-and-password login
 * with the password "demo-password-123", hashed by Better Auth itself, then
 * prints the logins. Uses DATABASE_URL (the repo-root .env locally).
 * Refuses to run in production: demo passwords never go near real logins.
 */

async function main(): Promise<number> {
  loadRootEnv();
  if (process.env.NODE_ENV === "production" || process.env.DWRG_ENV === "production") {
    process.stderr.write("seed-auth refuses to run in production.\n");
    return 1;
  }

  let env: ReturnType<typeof parseEnv>;
  try {
    env = parseEnv();
  } catch (error) {
    if (error instanceof InvalidEnvError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const database = createDb(env.DATABASE_URL, { max: 2 });
  try {
    const auth = createAuth({ db: database.db, env, logger: silentLogger });
    const logins = await seedDemoLogins(database.db, auth, { emailDomain: DEMO_EMAIL_DOMAIN });
    if (logins.length === 0) {
      process.stderr.write(
        `No demo users (@${DEMO_EMAIL_DOMAIN}) in ${redactUrl(env.DATABASE_URL)}. Run pnpm db:seed first.\n`,
      );
      return 1;
    }

    const counts = { created: 0, updated: 0, unchanged: 0 };
    for (const login of logins) counts[login.result] += 1;

    const roleWidth = Math.max(...logins.map((l) => ROLE_LABELS[l.role].length));
    const emailWidth = Math.max(...logins.map((l) => l.email.length));
    const lines = [
      `Demo logins in ${redactUrl(env.DATABASE_URL)}`,
      `(${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged)`,
      "",
      `Password for every login: ${DEMO_PASSWORD}`,
      "",
      ...logins.map(
        (l) =>
          `  ${ROLE_LABELS[l.role].padEnd(roleWidth)}  ${l.email.padEnd(emailWidth)}  ${l.name}${
            l.active ? "" : "  (turned off)"
          }`,
      ),
      "",
      `Sign in at ${env.WEB_ORIGIN}, or POST ${env.BETTER_AUTH_URL}/api/auth/sign-in/email.`,
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  } finally {
    await database.close();
  }
}

/** The URL without its password, for messages. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "DATABASE_URL";
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `seed-auth failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
