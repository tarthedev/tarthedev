import { fileURLToPath } from "node:url";

/**
 * Settings shared by playwright.config.ts, the API harness (api-server.ts)
 * and the specs. The e2e run uses its own ports so it never collides with a
 * dev server on 8787/5173, and 127.0.0.1 rather than "localhost" so Node,
 * Vite and the browsers all agree on IPv4. API and web app are on the same
 * host (different ports), so the session cookie is same-site, as in
 * production where Caddy serves both from one origin.
 */

const port = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a port number`);
  }
  return value;
};

export const E2E_HOST = "127.0.0.1";
export const API_PORT = port("E2E_API_PORT", 18_787);
export const WEB_PORT = port("E2E_WEB_PORT", 15_173);
export const API_ORIGIN = `http://${E2E_HOST}:${API_PORT}`;
export const WEB_ORIGIN = `http://${E2E_HOST}:${WEB_PORT}`;

/** Repo root and the folders the harness and specs use. */
export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const API_DIR = fileURLToPath(new URL("../../../api/", import.meta.url));
export const DEMO_EXPORTS_DIR = fileURLToPath(
  new URL("../../../../tools/st-import/fixtures/demo/", import.meta.url),
);

/**
 * The demo logins seed-auth creates (apps/api/src/services/demo-logins.ts):
 * the seeded demo staff, all with this password. Demo data only; never real.
 */
export const DEMO_PASSWORD = "demo-password-123";

export const DEMO_LOGINS = {
  owner: { email: "jeffrey.roberts@demo.dwrg.example", name: "Jeffrey Roberts" },
  manager: { email: "tracey.cremin@demo.dwrg.example", name: "Tracey Cremin" },
  dispatcher: { email: "hollie.will@demo.dwrg.example", name: "Hollie Will" },
  tech: { email: "alexane.walker@demo.dwrg.example", name: "Alexane Walker" },
  installer: { email: "denis.jenkins@demo.dwrg.example", name: "Denis Jenkins" },
} as const;

export type DemoLogin = keyof typeof DEMO_LOGINS;

/** The iPad (A16) the techs use: 820 x 1180 points. */
export const IPAD_PORTRAIT = { width: 820, height: 1180 } as const;
export const IPAD_LANDSCAPE = { width: 1180, height: 820 } as const;
