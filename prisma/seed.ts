/**
 * Seed data for previewing the dashboard before any real screenshots exist.
 *
 * Everything generated here is CLEARLY FICTIONAL sample data for a demo
 * account. It is never presented as real Victra production, and the seed
 * refuses to touch an account that already has snapshots.
 *
 *   npm run db:seed                 # creates demo@example.com / demo-password-123
 *   SEED_EMAIL=me@example.com npm run db:seed
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";

import { PrismaClient } from "../src/generated/prisma/index.js";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // fall through to the ambient environment
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Cannot seed.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const EMAIL = process.env.SEED_EMAIL ?? "demo@example.com";
const PASSWORD = process.env.SEED_PASSWORD ?? "demo-password-123";
const TIMEZONE = process.env.TIMEZONE ?? "America/New_York";

/** Same scrypt format as src/lib/auth/password.ts. */
async function hashPassword(password: string): Promise<string> {
  const { randomBytes, scrypt } = await import("node:crypto");
  const { promisify } = await import("node:util");
  const derive = promisify(scrypt) as (
    p: string,
    s: Buffer,
    k: number,
    o: { N: number; r: number; p: number; maxmem: number },
  ) => Promise<Buffer>;

  const salt = randomBytes(16);
  const key = await derive(password.normalize("NFKC"), salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
  return ["scrypt", 32768, 8, 1, salt.toString("base64"), key.toString("base64")].join("$");
}

const SAMPLE_KPIS = [
  { key: "internet", displayName: "Internet", category: "Growth", weight: 3, target: 12, pattern: [1, 2, 1, 0, 2, 1, 1] },
  { key: "vmp", displayName: "VMP", category: "Protection", weight: 2, target: 15, pattern: [3, 2, 3, 0, 2, 3, 2] },
  { key: "smb", displayName: "SMB", category: "Business", weight: 2, target: 4, pattern: [1, 0, 1, 0, 0, 1, 0] },
  { key: "cpg", displayName: "CPG", category: "Growth", weight: 1.5, target: 20, pattern: [3, 4, 2, 0, 3, 4, 3] },
  { key: "accessories", displayName: "Accessories", category: "Attach", weight: 1, target: 900, pattern: [140, 180, 95, 0, 160, 210, 130], unitType: "CURRENCY" as const },
];

function dateKey(offsetDays: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function utcDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

async function main(): Promise<void> {
  console.log(`Seeding sample data for ${EMAIL}…`);

  const existing = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: { id: true, _count: { select: { snapshots: true } } },
  });

  if (existing && existing._count.snapshots > 0) {
    console.log(
      `${EMAIL} already has ${existing._count.snapshots} snapshots. Refusing to seed over real data — pass SEED_EMAIL to use a different account.`,
    );
    return;
  }

  const user =
    existing ??
    (await prisma.user.create({
      data: {
        email: EMAIL,
        passwordHash: await hashPassword(PASSWORD),
        name: "Demo User",
        timezone: TIMEZONE,
        onboardedAt: new Date(),
      },
      select: { id: true, _count: { select: { snapshots: true } } },
    }));

  // Week containing today, Sunday-start, matching the app default.
  const today = dateKey(0);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const weekStart = dateKey(-dow);
  const weekEnd = dateKey(6 - dow);

  const kpiIds = new Map<string, string>();
  for (const [index, sample] of SAMPLE_KPIS.entries()) {
    const kpi = await prisma.kpiDefinition.upsert({
      where: { userId_key: { userId: user.id, key: sample.key } },
      create: {
        userId: user.id,
        key: sample.key,
        displayName: sample.displayName,
        description: "Sample KPI created by the seed script.",
        category: sample.category,
        unitType: sample.unitType ?? "COUNT",
        weight: sample.weight,
        sortOrder: index,
      },
      update: { weight: sample.weight, category: sample.category },
      select: { id: true },
    });
    kpiIds.set(sample.key, kpi.id);

    await prisma.goal.upsert({
      where: {
        userId_kpiId_periodType_periodStart_scope: {
          userId: user.id,
          kpiId: kpi.id,
          periodType: "WEEKLY",
          periodStart: utcDate(weekStart),
          scope: "PERSONAL",
        },
      },
      create: {
        userId: user.id,
        kpiId: kpi.id,
        periodType: "WEEKLY",
        periodStart: utcDate(weekStart),
        periodEnd: utcDate(weekEnd),
        targetValue: sample.target,
        minimumValue: Math.round(sample.target * 0.8),
        stretchValue: Math.round(sample.target * 1.25),
        priority: index,
        notes: "Sample goal from the seed script.",
      },
      update: { targetValue: sample.target, periodEnd: utcDate(weekEnd) },
    });
  }

  // One day off mid-week so shift-based pacing has something to show.
  for (let offset = 0; offset < 7; offset++) {
    const date = dateKey(offset - dow);
    await prisma.shift.upsert({
      where: { userId_date: { userId: user.id, date: utcDate(date) } },
      create: {
        userId: user.id,
        date: utcDate(date),
        kind: offset === 3 ? "OFF" : "WORK",
        hours: offset === 3 ? null : 8,
      },
      update: {},
    });
  }

  // One snapshot per elapsed day, each carrying the running period-to-date
  // totals the Victra dashboard would show.
  const running = new Map<string, number>(SAMPLE_KPIS.map((s) => [s.key, 0]));
  let created = 0;

  for (let dayIndex = 0; dayIndex <= dow; dayIndex++) {
    const date = dateKey(dayIndex - dow);
    const capturedAt = new Date(`${date}T21:30:00.000Z`);

    for (const sample of SAMPLE_KPIS) {
      running.set(sample.key, (running.get(sample.key) ?? 0) + (sample.pattern[dayIndex] ?? 0));
    }

    const snapshot = await prisma.snapshot.create({
      data: {
        userId: user.id,
        capturedAt,
        status: "CONFIRMED",
        confirmedAt: capturedAt,
        imageCount: 0,
        overallConfidence: 0.97,
        extractionModel: "seed-script",
        extractionPromptVersion: "seed",
        reportingPeriodStart: utcDate(weekStart),
        reportingPeriodEnd: utcDate(weekEnd),
        periodDetected: true,
        notes: "Sample snapshot generated by the seed script — not real Victra data.",
      },
      select: { id: true },
    });
    created += 1;

    await prisma.metricObservation.createMany({
      data: SAMPLE_KPIS.map((sample) => {
        const value = running.get(sample.key) ?? 0;
        return {
          id: randomUUID(),
          userId: user.id,
          snapshotId: snapshot.id,
          kpiId: kpiIds.get(sample.key) as string,
          rawLabel: sample.displayName,
          rawValue: String(value),
          value,
          aiValue: value,
          confidence: 0.97,
          status: "ACCEPTED" as const,
          effectiveAt: capturedAt,
          periodStart: utcDate(weekStart),
          periodEnd: utcDate(weekEnd),
        };
      }),
    });
  }

  console.log(`Done. ${created} sample snapshots for ${EMAIL}.`);
  if (!existing) console.log(`Sign in with ${EMAIL} / ${PASSWORD} — change the password after first login.`);
  console.log("All values are fictional sample data, not real Victra production.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
