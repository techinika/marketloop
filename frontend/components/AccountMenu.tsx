"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { formatPrice } from "@/lib/api";
import { signOutUser } from "@/lib/firebase";
import { fetchWallet } from "@/lib/wallet";
import { useMe } from "@/lib/useMe";
import { useToast } from "@/components/ui/Toast";

const REFRESH_MS = 60_000;

/** Compact wallet balance pill in the header; links to /wallet. Hidden on small screens. */
export function WalletBalance() {
  const { firebaseUser: user } = useMe();
  const [balance, setBalance] = useState<{ amount: number; currency: string } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      try {
        const wallet = await fetchWallet();
        if (cancelled) return;
        const first = wallet.transactions[0];
        setBalance({
          amount: wallet.walletBalance,
          currency: first?.currency ?? "RWF",
        });
      } catch {
        // Header balance is non-critical — stay quiet.
      }
    };
    void run();
    const interval = setInterval(() => void run(), REFRESH_MS);
    const onFocus = () => void run();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [user, toast]);

  if (!user || balance === null) return null;

  return (
    <Link
      href="/wallet"
      className="hidden items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted sm:inline-flex"
    >
      <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
      {formatPrice(balance.amount, balance.currency)}
    </Link>
  );
}

/** User avatar + account dropdown (Dashboard, My Bids, My Listings, Wallet, Admin, Sign out). */
export function AccountMenu() {
  const { firebaseUser: user, me } = useMe();
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (!(target instanceof Element) || !target.closest("[data-account-menu]")) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  const handleSignOut = async () => {
    setOpen(false);
    try {
      await signOutUser();
      router.push("/");
    } catch {
      toast({ title: "Sign out failed", variant: "error" });
    }
  };

  if (!user) {
    return (
      <Link href="/" className="btn btn-primary hidden sm:inline-flex">
        Sign in
      </Link>
    );
  }

  const initial = (user.displayName ?? user.email ?? "U").charAt(0).toUpperCase();
  const items: Array<{ href: string; label: string }> = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/my-bids", label: "My Bids" },
    { href: "/sell/my-listings", label: "My Listings" },
    { href: "/wallet", label: "Wallet" },
    { href: "/account/verification", label: "Verification" },
  ];
  if (me?.isAdmin === true) {
    items.push({ href: "/admin", label: "Admin" });
  }

  return (
    <div className="relative" data-account-menu>
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-surface-muted"
      >
        {user.photoURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.photoURL}
            alt={user.displayName ?? "Account"}
            className="size-8 rounded-full border border-border object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-strong">
            {initial}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-60 overflow-hidden rounded-card bg-surface shadow-lifted ring-1 ring-border">
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-semibold text-foreground">
              {user.displayName ?? "Signed in"}
            </p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <nav className="flex flex-col p-1.5">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-border p-1.5">
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
