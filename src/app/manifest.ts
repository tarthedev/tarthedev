import type { MetadataRoute } from "next";

/**
 * PWA manifest, served by Next at /manifest.webmanifest.
 *
 * Added to a home screen the app opens standalone with no browser chrome,
 * which is how it is actually used on a sales floor.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KPI Command Center",
    short_name: "KPI",
    description: "Turn raw KPI screenshots into actionable sales decisions.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0b",
    theme_color: "#0a0a0b",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Upload snapshot", url: "/upload" },
      { name: "AI Coach", url: "/coach" },
    ],
  };
}
