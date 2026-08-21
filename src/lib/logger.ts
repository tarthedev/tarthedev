import { prisma } from "@/lib/db";

type Level = "INFO" | "WARN" | "ERROR";

/**
 * Minimal observability: structured lines on stdout for `docker logs`, plus a
 * durable row for anything worth reviewing in the app. Deliberately not an
 * enterprise monitoring stack.
 */
interface LogArgs {
  userId?: string | null;
  category: string;
  message: string;
  meta?: Record<string, unknown>;
}

const SENSITIVE = /^(password|token|secret|api[_-]?key|authorization|cookie)$/i;

/** Strips anything that must never reach a log line or the database. */
function redact(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    out[key] = SENSITIVE.test(key) ? "[redacted]" : value;
  }
  return out;
}

async function write(level: Level, args: LogArgs): Promise<void> {
  const meta = redact(args.meta);
  const line = JSON.stringify({
    level,
    category: args.category,
    message: args.message,
    ...(meta ? { meta } : {}),
    at: new Date().toISOString(),
  });

  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);

  // Persisting a log line must never take down the operation it describes.
  try {
    await prisma.eventLog.create({
      data: {
        userId: args.userId ?? null,
        level,
        category: args.category,
        message: args.message.slice(0, 2000),
        meta: meta ? (meta as object) : undefined,
      },
    });
  } catch {
    // stdout already has it
  }
}

export const logger = {
  info: (args: LogArgs) => write("INFO", args),
  warn: (args: LogArgs) => write("WARN", args),
  error: (args: LogArgs) => write("ERROR", args),
};
