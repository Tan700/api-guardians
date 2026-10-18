import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "API Guardian — Contract change detection",
  description: "Detect potentially breaking API changes before they break integrations."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
