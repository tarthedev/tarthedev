import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const NAVY = "#14213D";
const PAPER = "#F7F5F0";

/**
 * The web app: React 19 + TanStack Router (file routes in src/routes) +
 * Tailwind 4, installable on the iPad as a home-screen app (vite-plugin-pwa).
 *
 * The service worker caches the app shell only (HTML, JS, CSS, icons). API
 * calls (/api, /health) always go to the network: nothing about customers,
 * jobs or money is ever served from a cache.
 */
export default defineConfig({
  plugins: [
    // Must come before the React plugin.
    tanstackRouter({ target: "react", autoCodeSplitting: true, quoteStyle: "double" }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // A small registerSW.js loaded from index.html (infra/Caddyfile serves it uncached).
      injectRegister: "script",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "DWRG",
        short_name: "DWRG",
        description: "DWRG Heating & Cooling: office and field app",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        theme_color: NAVY,
        background_color: PAPER,
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // App routes open index.html offline; API paths never do.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/health$/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/") || url.pathname === "/health",
            handler: "NetworkOnly",
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173 },
  preview: { port: 4173 },
  // Maps for error reports (Sentry), not linked from the shipped files. The
  // Docker build (apps/web/Dockerfile) deletes them from what Caddy serves.
  build: { sourcemap: "hidden" },
});
