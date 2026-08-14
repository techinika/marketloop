import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { HeroIllustration } from "@/components/HeroIllustration";

export const metadata: Metadata = {
  title: "MarketLoop — Buy and sell used goods safely in Rwanda",
  description:
    "MarketLoop is a peer-to-peer second-hand marketplace where every payment is held in escrow until delivery is confirmed. Buy and sell used phones, electronics, furniture and more in Rwanda.",
  alternates: { canonical: "/" },
};

const TRUST_ITEMS = [
  {
    title: "Escrow on every sale",
    description: "Money is only released once the buyer confirms delivery.",
  },
  {
    title: "Mobile money & cards",
    description: "Pay and withdraw with MTN MoMo, Airtel Money, or card.",
  },
  {
    title: "Both parties protected",
    description: "Disputes and refunds are handled by a real support team.",
  },
];

const FEATURES: Array<{ icon: ReactNode; title: string; description: string }> = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-6" aria-hidden="true">
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z" />
      </svg>
    ),
    title: "Escrow payments",
    description: "Funds sit in escrow until you confirm you've received the item — never pay a stranger directly.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-6" aria-hidden="true">
        <path d="m12 2 8.5 4.5v11L12 22l-8.5-4.5v-11L12 2Z" />
        <path d="M12 22v-9" />
        <path d="M3.5 6.5 12 11l8.5-4.5" />
      </svg>
    ),
    title: "Negotiate or bid",
    description: "Send offers on priced items or place bids on auctions and let the market decide.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-6" aria-hidden="true">
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
        <path d="M15 18H9" />
        <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35a1 1 0 0 0-.78-.38H14" />
        <circle cx="17" cy="18" r="2" />
        <circle cx="7" cy="18" r="2" />
      </svg>
    ),
    title: "Delivery tracking",
    description: "Every order gets a delivery window, and both sides confirm once the item changes hands.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-6" aria-hidden="true">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </svg>
    ),
    title: "Pay your way",
    description: "Check out with MTN MoMo, Airtel Money, or your card through a trusted payment provider.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-6" aria-hidden="true">
        <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
        <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
      </svg>
    ),
    title: "Seller wallet",
    description: "Earnings land straight in your wallet — withdraw to mobile money whenever you want.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-6" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="m9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </svg>
    ),
    title: "Real support",
    description: "Admins monitor orders and step in for refunds, disputes, and force releases when needed.",
  },
];

const STEPS = [
  {
    step: "01",
    title: "List or browse",
    description: "Discover second-hand goods in the marketplace, or snap a few photos and list your own item in minutes.",
  },
  {
    step: "02",
    title: "Negotiate & pay",
    description: "Agree on a price with offers or bids. Pay with MoMo or card — the money is held safely in escrow.",
  },
  {
    step: "03",
    title: "Confirm & get paid",
    description: "Receive your item, confirm delivery, and escrow releases the funds to the seller. Simple and fair.",
  },
];

export default function Home() {
  return (
    <div className="flex-1">
      <section className="border-b border-border bg-surface">
        <div className="container-page grid items-center gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:gap-14">
          <div>
            <span className="badge badge-accent">
              <span className="size-1.5 rounded-full bg-accent" />
              Peer-to-peer marketplace · Rwanda
            </span>
            <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl sm:leading-tight">
              Buy and sell used goods,{" "}
              <span className="text-accent-strong">safely.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg leading-8 text-secondary">
              MarketLoop escrows every payment until the item is delivered — so buyers never lose
              their money and sellers always get paid.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/explore" className="btn btn-primary">
                Explore the marketplace
              </Link>
              <Link href="/sell/new" className="btn btn-secondary">
                Start selling
              </Link>
            </div>
          </div>

          <div className="w-full">
            <HeroIllustration />
          </div>
        </div>
      </section>

      <section className="container-page py-10">
        <ul className="grid gap-6 sm:grid-cols-3">
          {TRUST_ITEMS.map((item) => (
            <li key={item.title} className="flex gap-3">
              <span className="mt-1.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3 text-accent-strong" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-secondary">{item.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section id="features" className="bg-surface py-16 sm:py-20">
        <div className="container-page">
          <div className="mx-auto max-w-2xl text-center">
            <span className="badge badge-neutral">Why MarketLoop</span>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Built for trust, end to end
            </h2>
            <p className="mt-4 text-lg leading-8 text-secondary">
              Everything you need to trade second-hand goods without the risk of being scammed.
            </p>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="card p-6">
                <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
                  {feature.icon}
                </span>
                <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-secondary">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="container-page py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="badge badge-neutral">How it works</span>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Three steps to a safe trade
          </h2>
        </div>

        <ol className="mt-12 grid gap-6 lg:grid-cols-3">
          {STEPS.map((item) => (
            <li key={item.step} className="relative rounded-card border border-border bg-surface p-6">
              <span className="text-4xl font-semibold tracking-tight text-accent-strong/20">
                {item.step}
              </span>
              <h3 className="mt-3 text-lg font-semibold tracking-tight text-foreground">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-secondary">{item.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="container-page pb-20">
        <div className="card flex flex-col items-center gap-6 bg-gradient-to-br from-accent to-accent-strong p-10 text-center sm:p-14">
          <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Ready to find a deal or declutter?
          </h2>
          <p className="max-w-md text-base leading-7 text-emerald-50">
            Join the marketplace — list something you no longer need or grab a bargain today.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/explore"
              className="btn bg-white text-accent-strong hover:bg-emerald-50"
            >
              Explore now
            </Link>
            <Link
              href="/sell/new"
              className="btn border border-white/40 bg-white/10 text-white hover:bg-white/20"
            >
              List an item
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
