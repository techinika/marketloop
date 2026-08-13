"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";
import { AccountMenu, WalletBalance } from "@/components/AccountMenu";
import { NotificationBell } from "@/components/NotificationBell";

function Wordmark({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground"
    >
      <span className="flex size-6 items-center justify-center rounded-lg bg-accent text-[11px] font-bold text-white">
        M
      </span>
      {children}
    </Link>
  );
}

function MainNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/explore" ? pathname === "/explore" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-surface-muted text-foreground"
          : "text-secondary hover:bg-surface-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function MainHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="container-page flex h-14 items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Wordmark href="/">MarketLoop</Wordmark>
          <nav className="ml-4 hidden items-center gap-1 md:flex">
            <MainNavLink href="/explore">Explore</MainNavLink>
            <MainNavLink href="/sell/new">Sell</MainNavLink>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <WalletBalance />
          <NotificationBell />
          <AccountMenu />

          <button
            type="button"
            aria-label="Menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((prev) => !prev)}
            className="flex size-9 items-center justify-center rounded-full text-secondary transition-colors hover:bg-surface-muted hover:text-foreground md:hidden"
          >
            {mobileOpen ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5" aria-hidden="true">
                <path d="M4 6h16" />
                <path d="M4 12h16" />
                <path d="M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="border-t border-border bg-surface md:hidden">
          <div className="container-page flex flex-col gap-1 py-3">
            <Link
              href="/explore"
              onClick={() => setMobileOpen(false)}
              className="rounded-xl px-3 py-2.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              Explore
            </Link>
            <Link
              href="/sell/new"
              onClick={() => setMobileOpen(false)}
              className="rounded-xl px-3 py-2.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              Sell an item
            </Link>
            <Link
              href="/dashboard"
              onClick={() => setMobileOpen(false)}
              className="rounded-xl px-3 py-2.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              Dashboard
            </Link>
            <Link
              href="/my-bids"
              onClick={() => setMobileOpen(false)}
              className="rounded-xl px-3 py-2.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              My Bids
            </Link>
            <Link
              href="/sell/my-listings"
              onClick={() => setMobileOpen(false)}
              className="rounded-xl px-3 py-2.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              My Listings
            </Link>
            <Link
              href="/wallet"
              onClick={() => setMobileOpen(false)}
              className="rounded-xl px-3 py-2.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              Wallet
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}

function AdminNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-surface-muted text-foreground"
          : "text-secondary hover:bg-surface-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function AdminHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="container-page flex h-14 items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Wordmark href="/admin">MarketLoop Admin</Wordmark>
          <nav className="ml-4 flex items-center gap-1">
            <AdminNavLink href="/admin">Overview</AdminNavLink>
            <AdminNavLink href="/admin/orders">Orders</AdminNavLink>
            <AdminNavLink href="/admin/users">Users</AdminNavLink>
          </nav>
        </div>
        <Link
          href="/explore"
          className="rounded-full px-3.5 py-1.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          Back to site
        </Link>
      </div>
    </header>
  );
}

/** Shared top nav: main header for the marketplace, a slim admin header under /admin. */
export function SiteHeader() {
  const pathname = usePathname();
  const isAdminArea = pathname.startsWith("/admin");
  return isAdminArea ? <AdminHeader /> : <MainHeader />;
}
