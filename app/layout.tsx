import type { Metadata, Viewport } from "next";
// Fonts are bundled with the app (public/fonts) so no page load ever contacts a font service.
import "./globals.css";

export const metadata: Metadata = {
  title: "Pacer",
  description: "A free job search assistant: check your fit, tailor your resume, and track every application.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0d121d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="referrer" content="no-referrer" />
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body>{children}</body>
    </html>
  );
}
