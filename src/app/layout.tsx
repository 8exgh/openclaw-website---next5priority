import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Next 5 Priority",
  description: "A focused, hierarchical project command centre for teams and automation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
