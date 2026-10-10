/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The API's origin, e.g. http://localhost:8787. Leave unset in builds: the app calls its own origin. */
  readonly VITE_API_URL?: string;
  /** The deployed commit (apps/web/Dockerfile sets it). */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
