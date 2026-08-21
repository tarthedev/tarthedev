/**
 * Fixed-window rate limiter held in process memory.
 *
 * Deliberately simple: this is a single-user application behind one Node
 * process, so a shared store would be infrastructure without a purpose. If the
 * app is ever scaled to multiple instances, swap the Map for Redis behind the
 * same interface.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
let lastSweep = Date.now();

/** Drops expired windows so a long-lived process does not leak memory. */
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    const window: Window = { count: 1, resetAt: now + windowMs };
    windows.set(key, window);
    return { allowed: true, remaining: limit - 1, resetAt: window.resetAt, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/** Clears a window after a successful login so a good password resets the count. */
export function clearRateLimit(key: string): void {
  windows.delete(key);
}

/** Best-effort client identity from proxy headers, for login throttling. */
export function clientKey(request: Request, prefix: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return `${prefix}:${ip}`;
}
