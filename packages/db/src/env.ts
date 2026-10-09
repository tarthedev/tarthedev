import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Loads the repo-root `.env` (if there is one) into process.env without
 * overriding variables that are already set. CI sets real variables and has
 * no `.env`, so this is a no-op there.
 */
export function loadRootEnv(startDir: string = process.cwd()): void {
  const root = findRepoRoot(startDir);
  if (!root) return;
  const file = join(root, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

/** Nearest ancestor directory holding pnpm-workspace.yaml. */
export function findRepoRoot(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Reads a required environment variable, loading the root `.env` first if needed. */
export function requireEnv(name: string): string {
  if (!process.env[name]) loadRootEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env at the repo root.`);
  }
  return value;
}
