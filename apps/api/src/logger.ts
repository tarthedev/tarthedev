/**
 * Structured logs: one JSON object per line on stdout, which Docker keeps
 * (docs/runbooks/monitoring.md, "Logs"). Every request's lines carry its
 * request id. Never log passwords, cookies, tokens or card data.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A logger whose lines all include `bindings` (e.g. the request id). */
  child(bindings: LogFields): Logger;
}

export interface CreateLoggerOptions {
  level?: LogLevel;
  /** Fields on every line (service, environment, version). */
  base?: LogFields;
  /** Where lines go (default: stdout). Tests pass a collector or a no-op. */
  write?: (line: string) => void;
  /** Clock for the `time` field. */
  now?: () => Date;
}

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values are replaced before a line is written. */
const SECRET_KEYS = /pass(word)?|secret|token|cookie|authorization|card/i;

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const min = RANK[options.level ?? "info"];
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  const make = (bindings: LogFields): Logger => {
    const emit = (level: LogLevel, msg: string, fields?: LogFields) => {
      if (RANK[level] < min) return;
      const line = { time: now().toISOString(), level, msg, ...bindings, ...fields };
      try {
        write(JSON.stringify(line, replacer));
      } catch {
        write(JSON.stringify({ time: line.time, level, msg, logError: "unserializable fields" }));
      }
    };
    return {
      debug: (msg, fields) => emit("debug", msg, fields),
      info: (msg, fields) => emit("info", msg, fields),
      warn: (msg, fields) => emit("warn", msg, fields),
      error: (msg, fields) => emit("error", msg, fields),
      child: (more) => make({ ...bindings, ...more }),
    };
  };
  return make(options.base ?? {});
}

/** A logger that drops everything (tests). */
export const silentLogger: Logger = createLogger({ write: () => {} });

function replacer(key: string, value: unknown): unknown {
  if (key && SECRET_KEYS.test(key) && value !== null && value !== undefined) return "[redacted]";
  if (value instanceof Error) return serializeError(value);
  if (typeof value === "bigint") return value.toString();
  return value;
}

/** Errors as plain objects, including `cause` chains and Postgres error codes. */
export function serializeError(error: unknown): LogFields {
  if (!(error instanceof Error)) return { value: String(error) };
  const out: LogFields = { name: error.name, message: error.message, stack: error.stack };
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") out.code = code;
  if (error.cause !== undefined) out.cause = serializeError(error.cause);
  return out;
}
