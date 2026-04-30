import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WARP CodX",
  description:
    "Mobile-first command interface for orchestrating AI agents in WalkerMind OS.",
};

export const viewport: Viewport = {
  themeColor: "#0E0E0F",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${jetbrains.variable} dark`}>
      <body>{children}</body>
    </html>
  );
}
