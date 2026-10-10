"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";

const SUPPORT_EMAIL = "hello@handi.rw";

/**
 * Lightweight contact form with no backend: it composes a pre-filled email in
 * the visitor's mail client. Good enough for a support inbox while the site is
 * still growing.
 */
export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("General question");
  const [message, setMessage] = useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const subject = `[Handi] ${topic}`;
    const body = `Name: ${name}\nEmail: ${email}\n\n${message}`;
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="contact-name">
            Your name
          </label>
          <input
            id="contact-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            className="field w-full"
            placeholder="Aline Mukamana"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="contact-email">
            Email
          </label>
          <input
            id="contact-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={120}
            className="field w-full"
            placeholder="you@example.com"
          />
        </div>
      </div>

      <div>
        <label className="field-label" htmlFor="contact-topic">
          Topic
        </label>
        <select
          id="contact-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="field w-full"
        >
          <option>General question</option>
          <option>Buying &amp; orders</option>
          <option>Payments &amp; escrow</option>
          <option>Selling on Handi</option>
          <option>Report a problem</option>
        </select>
      </div>

      <div>
        <label className="field-label" htmlFor="contact-message">
          Message
        </label>
        <textarea
          id="contact-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          rows={6}
          maxLength={2000}
          className={cn("field w-full resize-y")}
          placeholder="Tell us how we can help…"
        />
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary">
          Send message
        </button>
        <p className="text-xs text-muted">
          Opens your email app — or write us at{" "}
          <a className="text-accent-strong underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    </form>
  );
}
