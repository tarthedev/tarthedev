import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ROLES } from "./enums";

/**
 * Better Auth 1.x core tables in the shape its Drizzle adapter expects:
 * the adapter maps by JS property name (`emailVerified`, `userId`, ...), and
 * the columns use the snake_case names Better Auth's generator emits.
 * Timestamps are timestamptz (the generator's default is plain `timestamp`)
 * so instants never depend on the server's TZ.
 *
 * `role` and `active` are our additional user fields; configure them in
 * Better Auth as `user.additionalFields` with `input: false`.
 */

const tz = { withTimezone: true, mode: "date" } as const;

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    role: text("role", { enum: ROLES }).notNull().default("tech"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    check("user_role_check", sql`${t.role} in (${sql.raw(ROLES.map((r) => `'${r}'`).join(", "))})`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_userId_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", tz),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", tz),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("account_userId_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type Verification = typeof verification.$inferSelect;
