import type { Metadata, Viewport } from "next";
import { Inter_Tight, Newsreader } from "next/font/google";
import "./globals.css";
import PreviewChrome from "@/components/PreviewChrome";

const sans = Inter_Tight({ subsets: ["latin"], variable: "--font-sans" });
const serif = Newsreader({ subsets: ["latin"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: {
    default: "Distributed Sites · Site pipeline",
    template: "%s · Distributed Sites",
  },
  description: "Site pipeline map for Phoenix, Las Vegas and Miami",
  applicationName: "Distributed Sites",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e4636",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>
        {children}
        <PreviewChrome />
      </body>
    </html>
  );
}
