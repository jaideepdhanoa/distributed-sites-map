import type { Metadata, Viewport } from "next";
import { Inter_Tight, Newsreader } from "next/font/google";
import "./globals.css";
import PreviewChrome from "@/components/PreviewChrome";
import CommandHotkey from "@/components/CommandHotkey";
import PreviewDbBanner from "@/components/PreviewDbBanner";

const sans = Inter_Tight({ subsets: ["latin"], variable: "--font-sans" });
const serif = Newsreader({ subsets: ["latin"], variable: "--font-serif" });

const buildSha = process.env.VERCEL_GIT_COMMIT_SHA || "";

export const metadata: Metadata = {
  title: {
    default: "Distributed Sites · Site pipeline",
    template: "%s · Distributed Sites",
  },
  description: "Site pipeline map for Phoenix, Las Vegas and Miami",
  applicationName: "Distributed Sites",
  robots: { index: false, follow: false },
  other: buildSha ? { "build-sha": buildSha } : undefined,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e4636",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`} data-build={buildSha}>
      <body>
        <PreviewDbBanner />
        {children}
        <CommandHotkey />
        <PreviewChrome />
      </body>
    </html>
  );
}
