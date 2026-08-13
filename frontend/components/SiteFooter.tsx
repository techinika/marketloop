import Link from "next/link";

const LINK_GROUPS: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: "Marketplace",
    links: [
      { label: "Explore", href: "/explore" },
      { label: "Sell an item", href: "/sell/new" },
      { label: "My bids", href: "/my-bids" },
      { label: "Wallet", href: "/wallet" },
    ],
  },
  {
    title: "Your account",
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "My listings", href: "/my-listings" },
      { label: "My orders", href: "/dashboard" },
      { label: "Notifications", href: "/dashboard" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "How it works", href: "/#how-it-works" },
      { label: "Features", href: "/#features" },
      { label: "Admin", href: "/admin" },
      { label: "Support", href: "mailto:support@marketloop.rw" },
    ],
  },
];

function Logo() {
  return (
    <span className="inline-flex size-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
      M
    </span>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="text-lg font-semibold tracking-tight text-foreground">MarketLoop</span>
          </div>
          <p className="mt-3 max-w-xs text-sm leading-6 text-secondary">
            A peer-to-peer marketplace where every payment is held in escrow until delivery is
            confirmed — so buying and selling used goods is safe for both sides.
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
          <p>&copy; {new Date().getFullYear()} MarketLoop. All rights reserved.</p>
          <p>
            Payments secured by escrow · MTN MoMo, Airtel Money &amp; cards supported
          </p>
        </div>
      </div>
    </footer>
  );
}
