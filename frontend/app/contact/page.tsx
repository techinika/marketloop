import type { Metadata } from "next";

import { ContentPage } from "@/components/ContentPage";
import { ContactForm } from "@/components/ContactForm";

export const metadata: Metadata = {
  title: "Contact us",
  description:
    "Get in touch with the Handi team — questions about buying, selling, payments and escrow, or reporting a problem with an order.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <ContentPage
      eyebrow="Contact"
      title="Talk to us"
      intro="Questions about an order, payments, or selling on Handi? Send us a message and a real person will get back to you — usually within one working day."
    >
      <section>
        <h2>Reach the team</h2>
        <ul>
          <li>
            <strong>Email:</strong>{" "}
            <a href="mailto:hello@handi.rw">hello@handi.rw</a>
          </li>
          <li>
            <strong>Support hours:</strong> Monday–Friday, 9:00–17:00 CAT
          </li>
          <li>
            <strong>Based in:</strong> Kigali, Rwanda
          </li>
        </ul>
        <p>
          For anything to do with an existing order, include your order
          reference so we can find it quickly.
        </p>
      </section>

      <section>
        <h2>Send a message</h2>
        <ContactForm />
      </section>
    </ContentPage>
  );
}
