import type { Metadata } from "next";
import Link from "next/link";

import { ContentPage } from "@/components/ContentPage";

export const metadata: Metadata = {
  title: "About Handi",
  description:
    "Handi connects Rwandan artisans with buyers at home and abroad — a marketplace for handmade craft, commissioned directly from the maker with escrow-protected payments.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <ContentPage
      eyebrow="About"
      title="Handmade in Rwanda, made for you"
      intro="Handi is a marketplace for Rwandan handicraft — baskets, Imigongo art, carvings, beads and textiles — bought directly from the artisans who make them, with every payment held safely in escrow."
    >
      <section>
        <h2>Why we exist</h2>
        <p>
          Rwanda has one of the deepest craft traditions in the region, and the
          people who practise it — mainly women, working from home studios and
          cooperatives — are too often invisible in the global market. Handi puts
          a name and a shop behind every piece, so buyers can commission a
          one-off directly from the maker and know exactly whose hands the work
          passed through.
        </p>
        <p>
          We built Handi around two ideas: craft should be traceable, and paying
          for it should be safe for both sides. Every order runs through escrow,
          so the artisan is guaranteed payment and the buyer is guaranteed the
          piece arrives before the money moves.
        </p>
      </section>

      <section>
        <h2>How buying works</h2>
        <ul>
          <li>
            <strong>Discover</strong> a piece by craft — browse categories, browse
            a maker&apos;s shop, or search the marketplace.
          </li>
          <li>
            <strong>Commission or buy.</strong> Order a made-to-order piece to
            your taste, or buy a finished item that&apos;s ready to ship.
          </li>
          <li>
            <strong>Pay safely.</strong> Pay with MTN MoMo, Airtel Money or card,
            in RWF or USD. Your money is held in escrow, not passed on
            immediately.
          </li>
          <li>
            <strong>Receive and confirm.</strong> When the piece reaches you,
            confirm delivery — and the payment is released to the artisan.
          </li>
        </ul>
      </section>

      <section>
        <h2>Our commitments</h2>
        <ul>
          <li>
            <strong>Named, verifiable makers.</strong> Sellers confirm their phone
            number and can complete identity verification, so the shop behind a
            listing is a real one.
          </li>
          <li>
            <strong>Honest availability.</strong> Made-to-order listings show
            whether a maker is open for orders or fully booked; ready-to-ship
            listings show real stock.
          </li>
          <li>
            <strong>Escrow on every order.</strong> Funds are released only after
            you confirm delivery, with a clear path to report a problem.
          </li>
        </ul>
      </section>

      <section>
        <h2>Start selling</h2>
        <p>
          If you make craft in Rwanda, Handi gives you a storefront, escrow-backed
          payments and buyers you can reach. It&apos;s free to list —
          {" "}
          <Link href="/sell/new">share your first piece</Link> and tell us your
          story.
        </p>
      </section>
    </ContentPage>
  );
}
