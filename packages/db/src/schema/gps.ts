import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { bps, localDate, oneOf, timestamptz } from "./columns";
import { GPS_PAUSED_REASONS, LOCATION_STATES } from "./enums";

/**
 * iPad GPS fixes, sent only while our app is on screen (docs/03 "Truck GPS").
 * High volume and pruned after a retention period, so a bigint identity key.
 */
export const gpsPings = pgTable(
  "gps_pings",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    /** When the iPad took the fix. */
    at: timestamptz("at").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    /** Meters. */
    accuracy: doublePrecision("accuracy"),
    /** Meters per second. */
    speed: doublePrecision("speed"),
    /** Degrees from north. */
    heading: doublePrecision("heading"),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
  },
  (t) => [index("gps_pings_user_id_at_idx").on(t.userId, t.at), index("gps_pings_at_idx").on(t.at)],
);

/** Current GPS state per tech: live, paused (beacon on hide), stale (no pings, no beacon) or off. */
export const locationStatus = pgTable(
  "location_status",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id),
    state: text("state", { enum: LOCATION_STATES }).notNull(),
    lastPingAt: timestamptz("last_ping_at"),
    lastLat: doublePrecision("last_lat"),
    lastLng: doublePrecision("last_lng"),
    pausedReason: text("paused_reason", { enum: GPS_PAUSED_REASONS }),
    pausedAt: timestamptz("paused_at"),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("location_status_state_check", oneOf(t.state, LOCATION_STATES)),
    check(
      "location_status_paused_reason_check",
      sql`${t.pausedReason} is null or ${oneOf(t.pausedReason, GPS_PAUSED_REASONS)}`,
    ),
  ],
);

/** Daily GPS coverage of on-the-clock time per tech. `coverage_bps` 10000 = 100%. */
export const gpsCoverageDaily = pgTable(
  "gps_coverage_daily",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    day: localDate("day").notNull(),
    onClockMinutes: integer("on_clock_minutes").notNull(),
    coveredMinutes: integer("covered_minutes").notNull(),
    coverageBps: bps("coverage_bps").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ name: "gps_coverage_daily_pkey", columns: [t.userId, t.day] }),
    check(
      "gps_coverage_daily_minutes_check",
      sql`${t.onClockMinutes} >= 0 and ${t.coveredMinutes} >= 0 and ${t.coveredMinutes} <= ${t.onClockMinutes}`,
    ),
    check("gps_coverage_daily_bps_check", sql`${t.coverageBps} between 0 and 10000`),
  ],
);

export type GpsPing = typeof gpsPings.$inferSelect;
export type NewGpsPing = typeof gpsPings.$inferInsert;
export type LocationStatus = typeof locationStatus.$inferSelect;
export type GpsCoverageDaily = typeof gpsCoverageDaily.$inferSelect;
