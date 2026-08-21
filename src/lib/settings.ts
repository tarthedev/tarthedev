import { z } from "zod";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * User-editable settings. Defaults come from the environment so a fresh install
 * is fully configured, and anything the user changes in the Settings page is
 * stored per-user in `app_settings` and wins.
 */
export const SettingsSchema = z.object({
  scheduleMode: z.enum(["calendar", "shifts"]).default("calendar"),
  /** 0 = Sunday. Victra weeks commonly run Sunday–Saturday. */
  weekStartsOn: z.number().int().min(0).max(6).default(0),
  defaultPeriodType: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).default("WEEKLY"),

  confidenceThreshold: z.number().min(0).max(1),
  monthlyBudgetUsd: z.number().nonnegative(),
  aiEnabled: z.boolean(),

  /** Ceiling on a single KPI's attainment inside the overall score. */
  scoreCapPct: z.number().min(100).max(500).default(150),

  models: z.object({
    extraction: z.string(),
    coach: z.string(),
    chat: z.string(),
    deepAnalysis: z.string(),
    escalation: z.string(),
  }),

  theme: z.enum(["light", "dark", "system"]).default("system"),
});

export type Settings = z.infer<typeof SettingsSchema>;
export const SettingsPatchSchema = SettingsSchema.partial();

const SETTINGS_KEY = "app";

export function defaultSettings(): Settings {
  const config = env();
  return SettingsSchema.parse({
    scheduleMode: "calendar",
    weekStartsOn: 0,
    defaultPeriodType: "WEEKLY",
    confidenceThreshold: config.AI_CONFIDENCE_THRESHOLD,
    monthlyBudgetUsd: config.AI_MONTHLY_BUDGET_USD,
    aiEnabled: config.AI_ENABLED,
    scoreCapPct: 150,
    models: {
      extraction: config.AI_EXTRACTION_MODEL,
      coach: config.AI_COACH_MODEL,
      chat: config.AI_CHAT_MODEL,
      deepAnalysis: config.AI_DEEP_ANALYSIS_MODEL,
      escalation: config.AI_ESCALATION_MODEL,
    },
    theme: "system",
  });
}

export async function getSettings(userId: string): Promise<Settings> {
  const row = await prisma.appSetting.findUnique({
    where: { userId_key: { userId, key: SETTINGS_KEY } },
  });
  const defaults = defaultSettings();
  if (!row) return defaults;

  const stored = row.value as Record<string, unknown>;
  const merged = {
    ...defaults,
    ...stored,
    models: { ...defaults.models, ...((stored.models as Record<string, string>) ?? {}) },
  };

  const parsed = SettingsSchema.safeParse(merged);
  // Corrupt or outdated stored settings must not break the dashboard.
  return parsed.success ? parsed.data : defaults;
}

export async function updateSettings(userId: string, patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings(userId);
  const next = SettingsSchema.parse({
    ...current,
    ...patch,
    models: { ...current.models, ...(patch.models ?? {}) },
  });

  await prisma.appSetting.upsert({
    where: { userId_key: { userId, key: SETTINGS_KEY } },
    create: { userId, key: SETTINGS_KEY, value: next },
    update: { value: next },
  });
  return next;
}
