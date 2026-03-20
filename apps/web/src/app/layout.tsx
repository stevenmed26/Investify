import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Investify",
  description: "AI-assisted stock trend platform",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}