import type { Metadata } from "next";
import Link from "next/link";

import { ContentPage } from "@/components/ContentPage";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "The terms that govern buying and selling handmade Rwandan craft on Handi, including escrow payments, made-to-order commissions and delivery.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <ContentPage
      eyebrow="Legal"
      title="Terms of Use"
      intro="These terms govern your use of Handi, a marketplace that connects Rwandan artisans with buyers at home and abroad. By creating an account or placing an order you agree to them."
      updated="January 2026"
    >
      <section>
        <h2>1. About Handi</h2>
        <p>
          Handi is an online marketplace for handmade Rwandan craft. Handi is
          not the maker of any item and does not own the pieces listed. We
          provide the platform, facilitate payment through escrow, and help both
          sides resolve problems — but the contract of sale is between the buyer
          and the artisan.
        </p>
      </section>

      <section>
        <h2>2. Accounts</h2>
        <ul>
          <li>You must provide accurate details and keep your account secure.</li>
          <li>You are responsible for activity under your account.</li>
          <li>
            Sellers should confirm a phone number and may complete identity
            verification to earn a “Verified” badge. Verification never changes
            the price or your ability to sell.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Listings and commissions</h2>
        <p>
          Listings are either <strong>ready to ship</strong> (a finished piece,
          paid in full) or <strong>made to order</strong> (a commission the
          artisan creates for you). For made-to-order pieces:
        </p>
        <ul>
          <li>
            You may choose to pay a 50% deposit up front and the balance once
            the piece is ready, or pay in full at checkout.
          </li>
          <li>
            Artisans state an estimated production time and the answers they
            need from you. These are estimates, not guaranteed deadlines.
          </li>
          <li>
            Handmade items vary. Small differences from the photos or
            description are normal and are not defects.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Payments and escrow</h2>
        <ul>
          <li>
            Payments are accepted via MTN MoMo, Airtel Money and supported card
            providers, in RWF or USD where offered.
          </li>
          <li>
            The buyer&apos;s payment is held in escrow. Funds are released to the
            artisan only after the buyer confirms delivery (and, for
            made-to-order pieces, the artisan has completed their side).
          </li>
          <li>
            If an order is not delivered within the stated window, it may be
            automatically refunded to the buyer.
          </li>
          <li>
            Disputes freeze the funds until Handi reviews the order and decides
            the outcome.
          </li>
        </ul>
      </section>

      <section>
        <h2>5. Delivery, confirmation and refunds</h2>
        <ul>
          <li>
            Delivery fees and who pays them are shown on each listing before
            checkout.
          </li>
          <li>
            Once both parties confirm delivery, escrow is released. A rating and
            optional comment may be left.
          </li>
          <li>
            Cancellations during production may split the deposit between the
            parties depending on how far the work has progressed. Commissions
            cancelled after work has begun for a buyer&apos;s fault may forfeit
            part of the deposit.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Prohibited items and conduct</h2>
        <ul>
          <li>No counterfeit, stolen, illegal or unsafe items.</li>
          <li>No harassment, fraud, or attempts to move payment off-platform.</li>
          <li>
            Do not misrepresent who made an item or where it comes from.
          </li>
        </ul>
      </section>

      <section>
        <h2>7. Fees</h2>
        <p>
          Handi may charge a commission on completed sales. Any applicable fee is
          disclosed to the artisan before a listing goes live and is deducted
          from the artisan&apos;s settlement at release.
        </p>
      </section>

      <section>
        <h2>8. Liability</h2>
        <p>
          Handi provides the marketplace “as is”. To the extent permitted by law,
          Handi is not liable for indirect losses arising from a transaction
          between a buyer and an artisan. Nothing in these terms limits rights
          that cannot be excluded under Rwandan law.
        </p>
      </section>

      <section>
        <h2>9. Changes and contact</h2>
        <p>
          We may update these terms as Handi evolves; material changes will be
          posted here. Questions? Email{" "}
          <a href="mailto:hello@handi.rw">hello@handi.rw</a>. See also our{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </section>
    </ContentPage>
  );
}
