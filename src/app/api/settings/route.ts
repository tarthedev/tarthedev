import { prisma } from "@/lib/db";
import { ok, parseJson, withAuth } from "@/lib/http/api";
import { getSettings, SettingsPatchSchema, updateSettings } from "@/lib/settings";
import { isMockAi } from "@/lib/env";

export const GET = withAuth(async ({ user }) => {
  const settings = await getSettings(user.id);
  return ok({
    settings,
    user: { id: user.id, email: user.email, name: user.name, timezone: user.timezone },
    // Surfaced so the Settings page can say plainly whether real calls are made.
    aiMode: isMockAi() ? "mock" : "live",
  });
});

export const PATCH = withAuth(async ({ user, request }) => {
  const body = await parseJson(request, SettingsPatchSchema);
  const settings = await updateSettings(user.id, body);
  return ok({ settings });
});
