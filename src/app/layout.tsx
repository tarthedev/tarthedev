import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ThemeScript } from "@/components/layout/theme-script";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "KPI Command Center",
    template: "%s · KPI Command Center",
  },
  description: "Turn raw KPI screenshots into actionable sales decisions.",
  applicationName: "KPI Command Center",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "KPI",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png" }, { url: "/icon.svg", type: "image/svg+xml" }],
    apple: "/apple-icon.png",
  },
  // This is private performance data; it should never be indexed.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-[var(--bg)] text-[var(--text)] antialiased">
        <a
          href="#main"
          className="sr-only-focusable absolute top-2 left-2 z-50 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-text)]"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
