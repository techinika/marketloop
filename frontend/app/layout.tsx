import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ToastProvider } from "@/components/ui/Toast";
import { siteUrl } from "@/lib/env";
import "@/styles/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "MarketLoop — Buy and sell used goods safely in Rwanda",
    template: "%s",
  },
  description:
    "MarketLoop is a peer-to-peer second-hand marketplace where every payment is held in escrow until delivery is confirmed. Buy and sell used phones, electronics, furniture and more in Rwanda.",
  openGraph: {
    siteName: "MarketLoop",
    title: "MarketLoop — Buy and sell used goods safely in Rwanda",
    description:
      "Peer-to-peer second-hand marketplace with escrow-protected payments. Pay with MTN MoMo, Airtel Money or card.",
    type: "website",
    url: "/",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ToastProvider>
          <SiteHeader />
          <main className="flex flex-1 flex-col">{children}</main>
          <SiteFooter />
        </ToastProvider>
      </body>
    </html>
  );
}
