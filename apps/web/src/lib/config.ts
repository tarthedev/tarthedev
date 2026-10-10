/**
 * Where the API lives. In development the API runs on its own port
 * (http://localhost:8787 unless VITE_API_URL says otherwise). A production
 * build calls its own origin: Caddy sends /api and /health to the API
 * (infra/Caddyfile), and one build serves staging and production.
 */
export const API_URL: string = (
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:8787" : "")
).replace(/\/+$/, "");

/** The deployed commit, shown in the footer; "dev" locally. */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "dev";
