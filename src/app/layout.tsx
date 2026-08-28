import type { Metadata } from "next";
import { site } from "../lib/config.ts";
import "./globals.css";

export const metadata: Metadata = {
  title: `${site.businessName} — ${site.location}`,
  description: `${site.businessName}: ${site.tagline}`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
