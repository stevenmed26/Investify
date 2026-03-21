import "./globals.css";
import type { Metadata } from "next";
import { HamburgerMenu } from "./components/Hamburgermenu";

export const metadata: Metadata = {
  title: "Investify",
  description: "AI-assisted stock trend platform",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="investify-navbar">
          <a href="/" className="investify-navbar-brand">
            Investify
          </a>
          <HamburgerMenu />
        </header>
        <div className="investify-navbar-spacer" />
        {children}
      </body>
    </html>
  );
}