import type { Metadata } from "next";
import Link from "next/link";

import { ContentPage } from "@/components/ContentPage";

export const metadata: Metadata = {
  title: "Shipping & returns",
  description:
    "How delivery, production times, fees and returns work on Handi — including escrow protection, cancellations and how to report a problem with an order.",
  alternates: { canonical: "/shipping" },
};

export default function ShippingPage() {
  return (
    <ContentPage
      eyebrow="Policy"
      title="Shipping & returns"
      intro="How your handmade piece gets to you, what it costs, and what happens if something isn't right. Escrow backs every order until you confirm delivery."
      updated="January 2026"
    >
      <section>
        <h2>Production times</h2>
        <p>
          Made-to-order pieces are crafted after you order. Every listing shows
          the artisan&apos;s estimated production time in days — this is the time
          to make the piece, before delivery. Ready-to-ship pieces are already
          finished and leave the artisan&apos;s studio as soon as payment clears.
        </p>
        <p>
          Because each piece is made by hand, small variations in colour, size and
          finish are normal and are part of what makes handmade work unique.
        </p>
      </section>

      <section>
        <h2>Delivery</h2>
        <ul>
          <li>
            <strong>Within Rwanda:</strong> delivery is arranged directly with the
            artisan and typically completes within a few days of the piece being
            ready.
          </li>
          <li>
            <strong>International:</strong> the artisan confirms the courier and
            cost with you before dispatch. Import duties or local taxes, where
            they apply, are the buyer&apos;s responsibility.
          </li>
          <li>
            <strong>Fees:</strong> each listing shows its delivery fee and
            whether the artisan or the buyer covers it. Fees are shown before you
            pay.
          </li>
        </ul>
      </section>

      <section>
        <h2>Escrow protection</h2>
        <p>
          Payments are held in escrow until you confirm the piece has arrived. If
          there is a problem, report it from the order page before the funds are
          released — the money stays held while it&apos;s reviewed. For
          made-to-order commissions, a deposit may be released to the artisan
          once work has genuinely started, with the balance held until delivery.
        </p>
      </section>

      <section>
        <h2>Returns and refunds</h2>
        <p>
          Handmade pieces are usually one of a kind, so returns are handled
          case by case rather than by a blanket policy. You are covered if:
        </p>
        <ul>
          <li>the piece arrives damaged or defective;</li>
          <li>it is materially different from what was described or agreed; or</li>
          <li>it never arrives.</li>
        </ul>
        <p>
          Report the issue before confirming delivery. We review the case with
          both sides and, where appropriate, arrange a refund or replacement.
          Refunded amounts are returned to your original payment method.
        </p>
      </section>

      <section>
        <h2>Cancellations</h2>
        <ul>
          <li>
            <strong>Ready-to-ship:</strong> cancel before the item is dispatched
            for a full refund.
          </li>
          <li>
            <strong>Made-to-order:</strong> cancelling after work has begun may
            mean the artisan keeps a deposit for materials and time already
            spent. The split is agreed and shown before you confirm.
          </li>
        </ul>
      </section>

      <section>
        <h2>Reporting a problem</h2>
        <p>
          Open the order from your account and choose to report an issue, or{" "}
          <Link href="/contact">contact the team</Link> with your order reference.
          We&apos;ll respond and keep the funds held until the matter is
          resolved. See also our{" "}
          <Link href="/terms">terms of use</Link> and{" "}
          <Link href="/privacy">privacy policy</Link>.
        </p>
      </section>
    </ContentPage>
  );
}
