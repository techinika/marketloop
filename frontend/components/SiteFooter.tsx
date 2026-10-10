import Link from "next/link";

const LINK_GROUPS: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: "Marketplace",
    links: [
      { label: "Discover", href: "/explore" },
      { label: "Browse by craft", href: "/#categories" },
      { label: "All artisans", href: "/artisan" },
      { label: "Featured artisans", href: "/#artisans" },
    ],
  },
  {
    title: "Selling & account",
    links: [
      { label: "Sell your craft", href: "/sell/new" },
      { label: "My listings", href: "/sell/my-listings" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "Verification", href: "/account/verification" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "How it works", href: "/#how-it-works" },
      { label: "FAQ", href: "/faq" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Shipping & returns", href: "/shipping" },
      { label: "Terms of use", href: "/terms" },
      { label: "Privacy policy", href: "/privacy" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
        <div>
          <span className="heading text-lg text-foreground">Handi</span>
          <p className="mt-3 max-w-xs text-sm leading-6 text-secondary">
            Handi is where Rwandan handiwork finds its people — commissioned
            straight from the artisan, with every payment held safely in escrow
            until the piece reaches you.
          </p>
        </div>

        {LINK_GROUPS.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{group.title}</h3>
            <ul className="mt-3 space-y-2.5">
              {group.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-secondary transition-colors hover:text-accent-strong"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-border">
        <div className="container-page flex flex-col gap-2 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Handi. All rights reserved.</p>
          <p>
            Made by hand, paid in escrow · MTN MoMo, Airtel Money &amp; cards supported
          </p>
        </div>
      </div>
    </footer>
  );
}
