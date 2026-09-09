import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Next 5 Priority",
  description:
    "Plan your next five features, manage the backlog, and track bugs together.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
