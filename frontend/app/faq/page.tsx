import type { Metadata } from "next";
import Link from "next/link";

import { ContentPage } from "@/components/ContentPage";
import { JsonLd } from "@/components/JsonLd";

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description:
    "Answers about buying and selling handmade Rwandan craft on Handi — escrow payments, MoMo and card, made-to-order timelines, shipping and returns.",
  alternates: { canonical: "/faq" },
};

interface QA {
  q: string;
  a: string;
}

const FAQS: QA[] = [
  {
    q: "What is Handi?",
    a: "Handi is an online marketplace for handmade Rwandan craft. Buyers commission pieces directly from named artisans, or buy finished items that are ready to ship. Handi is not a reseller — the artisan makes and sends the piece.",
  },
  {
    q: "How do payments work?",
    a: "You pay with MTN MoMo, Airtel Money or card, in Rwandan francs (RWF) or US dollars (USD). Your payment is held in escrow and only released to the artisan once you confirm the piece has arrived.",
  },
  {
    q: "What does escrow mean for me?",
    a: "Escrow protects both sides. The artisan is guaranteed to be paid for their work, and you are protected because the money does not reach them until you confirm delivery. If something goes wrong, you can report an issue before funds are released.",
  },
  {
    q: "What is the difference between made-to-order and ready to ship?",
    a: "Made-to-order items are crafted after you order, so they take as long as the artisan needs to make them — the estimated production time is shown on every listing. Ready-to-ship items are already finished, are paid in full up front, and ship from existing stock.",
  },
  {
    q: "How long does a commission take?",
    a: "Each made-to-order listing shows the artisan's estimated production time in days. Add delivery time on top of that. You can follow the order status from your account.",
  },
  {
    q: "Can I ask for a custom piece?",
    a: "Yes. Many made-to-order listings let you answer specific questions from the artisan, and often to attach a reference image and a short brief. Some pieces can also be negotiated — look for the bidding or negotiable option.",
  },
  {
    q: "How much does delivery cost?",
    a: "Each listing shows its delivery fee and whether the artisan or the buyer covers it. Delivery within Rwanda is arranged directly; for international orders the artisan will confirm the method. See Shipping & returns for the full policy.",
  },
  {
    q: "What if the piece arrives damaged or isn't what I expected?",
    a: "Report the problem from the order page before the funds are released. We will review the case with you and the artisan and, where appropriate, arrange a refund or replacement under our Shipping & returns policy.",
  },
  {
    q: "Do I need to verify my identity to sell?",
    a: "You need to confirm your phone number to sell, and you can complete identity verification to earn a verified badge. Verified shops build more trust with buyers. See the verification page in your account.",
  },
  {
    q: "How much does it cost to sell on Handi?",
    a: "Listing is free. Handi charges a commission on completed orders, deducted automatically from the escrow release — you are never asked to pay upfront to list a piece.",
  },
];

export default function FaqPage() {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <>
      <JsonLd data={schema} />
      <ContentPage
        eyebrow="Help"
        title="Frequently asked questions"
        intro="Quick answers about buying, selling, payments and delivery on Handi. Can't find what you're looking for? Contact us and we'll help."
      >
        <section className="space-y-3">
          {FAQS.map((item) => (
            <details
              key={item.q}
              className="group rounded-card border border-border bg-surface p-5 [&[open]]:bg-background"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-foreground marker:content-none">
                {item.q}
                <span
                  aria-hidden="true"
                  className="text-muted transition-transform duration-200 group-open:rotate-45"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </section>

        <section>
          <h2>Still need help?</h2>
          <p>
            Read our <Link href="/shipping">shipping &amp; returns policy</Link>, or{" "}
            <Link href="/contact">contact the team</Link> with your order
            reference and we&apos;ll take it from there.
          </p>
        </section>
      </ContentPage>
    </>
  );
}
