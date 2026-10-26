import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Chess Coach — Find your next move",
  description:
    "A thoughtful chess study workspace. Replay your games, explore positions, and build better habits.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
