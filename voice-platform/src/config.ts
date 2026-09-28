import { z } from "zod";

// Every setting lives in environment variables (see .env.example). Values that
// describe the business itself come from rollinsonnetwork.com and default to
// what the live site says today.

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const csv = z
  .string()
  .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean));

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "use HH:MM (24h)");

const DEV_SECRET_DEFAULT = "dev-secret-change-me-please";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATA_DIR: z.string().default("./data"),
  APP_SECRET: z.string().min(16).default(DEV_SECRET_DEFAULT),
  ADMIN_USER: z.string().default("aaron"),
  ADMIN_PASSWORD: z.string().default(""),
  TIMEZONE: z.string().default("America/New_York"),

  // Claude
  ANTHROPIC_API_KEY: z.string().default(""),
  VOICE_MODEL: z.string().default("claude-opus-5"),
  VOICE_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  WORKER_MODEL: z.string().default("claude-opus-5"),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  SALES_CALLER_ID: z.string().default(""),
  DEMO_LINE_NUMBER: z.string().default(""),
  SMS_FROM: z.string().default(""),
  SALES_VOICE: z.string().default("UgBBYS2sOqTuMpoF3BR0-flash_v2_5-1.0_0.6_0.8"),
  RECEPTIONIST_VOICE: z.string().default("NYC9WEgkq1u4jiqBseQ9-flash_v2_5-1.0_0.6_0.8"),
  RECORD_SALES_CALLS: bool.default(true),
  VALIDATE_TWILIO_SIGNATURES: bool.default(true),

  // The business
  BUSINESS_NAME: z.string().default("Rollinson Network"),
  OWNER_NAME: z.string().default("Aaron Rollinson"),
  OWNER_FIRST_NAME: z.string().default("Aaron"),
  OWNER_PRONOUNS: z.string().default("they/them"),
  OWNER_CELL: z.string().default("+12522503044"),
  OWNER_EMAIL: z.string().default("aaron@rollinsonnetwork.com"),
  HOME_CITY: z.string().default("Elizabeth City"),
  SERVICE_AREA: z
    .string()
    .default("Elizabeth City and the Albemarle: Pasquotank, Camden, Currituck, and Perquimans counties"),
  SALES_AGENT_NAME: z.string().default("Riley"),

  // Stripe
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_PRICE_WEBSITE: z.string().default(""),
  STRIPE_PRICE_WEBSITE_MONTHLY: z.string().default(""),
  STRIPE_PRICE_RECEPTIONIST_ADDON: z.string().default(""),
  STRIPE_PRICE_RECEPTIONIST_SOLO: z.string().default(""),

  // Cal.com
  CALCOM_API_KEY: z.string().default(""),
  CALCOM_EVENT_TYPE_ID: z.coerce.number().optional(),
  CALCOM_BOOKING_URL: z.string().default(""),

  // Email (Resend)
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default("Rollinson Network <ai@rollinsonnetwork.com>"),

  // Lead finding
  GOOGLE_PLACES_API_KEY: z.string().default(""),

  // Dialer + compliance
  DIALER_ENABLED: bool.default(false),
  CALL_WINDOW_START: hhmm.default("09:30"),
  CALL_WINDOW_END: hhmm.default("16:30"),
  CALL_DAYS: csv.default(["1", "2", "3", "4", "5"]),
  WEB_LEAD_WINDOW_START: hhmm.default("08:00"),
  WEB_LEAD_WINDOW_END: hhmm.default("20:00"),
  MAX_ATTEMPTS: z.coerce.number().default(3),
  RETRY_GAP_HOURS: z.coerce.number().default(48),
  DAILY_CALL_CAP: z.coerce.number().default(60),
  MAX_CONCURRENT_CALLS: z.coerce.number().default(1),
  AI_COLD_CALL_LINE_TYPES: csv.default(["landline", "fixedVoip"]),
  VOICEMAIL_MODE: z.enum(["leave", "hangup"]).default("leave"),
  ALLOW_LIVE_TRANSFER: bool.default(true),

  // Website form
  WEB_LEAD_ALLOWED_ORIGINS: csv.default(["https://rollinsonnetwork.com", "https://www.rollinsonnetwork.com"]),
});

export type Config = z.infer<typeof schema>;

const DEV_SECRET = DEV_SECRET_DEFAULT;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // Blank lines in .env (KEY=) mean "use the default".
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.APP_SECRET === DEV_SECRET) {
    throw new Error("Set APP_SECRET in .env (run: openssl rand -hex 32)");
  }
  return parsed.data;
}

export const config: Config = loadConfig();

export function publicUrl(path: string): string {
  return new URL(path, config.PUBLIC_BASE_URL).toString();
}

export function wsUrl(path: string): string {
  const u = new URL(path, config.PUBLIC_BASE_URL);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

/** What each piece of the platform needs before it will run. Shown on the dashboard. */
export function readiness(c: Config = config) {
  const has = (...keys: (keyof Config)[]) => keys.every((k) => Boolean(c[k]));
  return {
    claude: has("ANTHROPIC_API_KEY"),
    twilio: has("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"),
    salesLine: has("SALES_CALLER_ID"),
    demoLine: has("DEMO_LINE_NUMBER"),
    sms: has("TWILIO_ACCOUNT_SID") && Boolean(c.SMS_FROM || c.SALES_CALLER_ID),
    email: has("RESEND_API_KEY"),
    stripe: has("STRIPE_SECRET_KEY", "STRIPE_PRICE_WEBSITE"),
    calcom: has("CALCOM_API_KEY") && Boolean(c.CALCOM_EVENT_TYPE_ID),
    places: has("GOOGLE_PLACES_API_KEY"),
    admin: has("ADMIN_PASSWORD"),
  };
}
