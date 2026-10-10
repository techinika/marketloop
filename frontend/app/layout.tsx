import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Fraunces, Geist_Mono, Work_Sans } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { JsonLd } from "@/components/JsonLd";
import { ToastProvider } from "@/components/ui/Toast";
import { siteUrl } from "@/lib/env";
import { organizationSchema } from "@/lib/seo";
import "@/styles/globals.css";

const workSans = Work_Sans({
  variable: "--font-work-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Handi — Handmade Rwandan craft, made to order and ready to ship",
    template: "%s — Handi",
  },
  description:
    "Handi is the marketplace for Rwandan handicraft and made-to-order art. Discover baskets, Imigongo panels, wood carvings and more — commissioned directly from the artisan who makes them, with every payment held safely in escrow.",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  openGraph: {
    siteName: "Handi",
    title: "Handi — Handmade Rwandan craft, made for you",
    description:
      "Discover baskets, Imigongo art, wood carvings and more from Rwandan artisans. Pay securely with escrow, MoMo or card.",
    type: "website",
    url: "/",
    locale: "en_RW",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Handi — Handmade Rwandan craft, made for you",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Handi — Handmade Rwandan craft, made for you",
    description:
      "Discover textiles, baskets and art — made to order and ready to ship, directly from Rwandan artisans.",
    images: ["/twitter-image"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: "#FBF8F3",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en-RW"
      className={`${workSans.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <JsonLd data={organizationSchema()} />
        <ToastProvider>
          <SiteHeader />
          <main className="flex flex-1 flex-col">{children}</main>
          <SiteFooter />
        </ToastProvider>
      </body>
    </html>
  );
}
