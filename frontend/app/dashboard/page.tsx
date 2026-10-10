"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { User as FirebaseUser } from "firebase/auth";

import { formatPrice } from "@/lib/api";
import { observeAuthState } from "@/lib/firebase";
import { fetchMyOrders, fetchSalesOrders } from "@/lib/orders";
import { fetchWallet } from "@/lib/wallet";
import { fetchMyListings } from "@/lib/products";
import type { DashboardOrder, EscrowStatus, Product, ProductType } from "@/types";
import { cn } from "@/lib/cn";
import { ListRowSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

const STATUS_BADGE: Record<EscrowStatus, { label: string; cls: string }> = {
  pending_payment: { label: "Awaiting payment", cls: "badge-warning" },
  held: { label: "In escrow", cls: "badge-info" },
  released: { label: "Released", cls: "badge-success" },
  refunded: { label: "Refunded", cls: "badge-neutral" },
  refund_requested: { label: "Refund requested", cls: "badge-warning" },
  failed: { label: "Failed", cls: "badge-danger" },
};

const KIND_BADGE: Record<ProductType, { label: string; cls: string }> = {
  made_to_order: { label: "Made to order", cls: "badge-ochre" },
  ready_to_ship: { label: "Ready to ship", cls: "badge-secondary" },
};

function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold tracking-tight text-foreground", tone)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function OrderRow({ order, kind }: { order: DashboardOrder; kind: "sale" | "purchase" }) {
  const badge = STATUS_BADGE[order.escrowStatus];
  const kindMeta = order.productType ? KIND_BADGE[order.productType] : null;
  const qty = order.quantity && order.quantity > 1 ? ` ×${order.quantity}` : "";
  return (
    <li>
      <Link
        href={`/orders/${order.id}`}
        className="flex items-center justify-between gap-3 rounded-lg px-1 py-3 transition-colors hover:bg-surface-muted"
      >
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">
            {order.product?.title ?? "Product removed"}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {formatDate(order.createdAt)}
            {kind === "sale" && order.buyer?.name && ` · ${order.buyer.name}`}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {kindMeta && <span className={cn("badge", kindMeta.cls)}>{kindMeta.label}</span>}
            {order.hasDispute === true && <span className="badge badge-danger">Under review</span>}
          </div>
        </div>
        <div className="text-right">
          <p className="font-semibold text-foreground">
            {formatPrice(order.totalPaid, order.currency)}
            {qty && <span className="text-xs font-normal text-muted"> for {qty}</span>}
          </p>
          <span className={cn("badge mt-1", badge.cls)}>{badge.label}</span>
        </div>
      </Link>
    </li>
  );
}

function OrderList({ orders, kind }: { orders: DashboardOrder[]; kind: "sale" | "purchase" }) {
  if (orders.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          icon="inbox"
          title={kind === "sale" ? "No sales yet" : "No purchases yet"}
          description={
            kind === "sale"
              ? "List a piece to start selling on the marketplace."
              : "Explore the marketplace to find something you love."
          }
        />
      </div>
    );
  }

  return (
    <ul className="mt-2 flex flex-col divide-y divide-border">
      {orders.map((order) => (
        <OrderRow key={order.id} order={order} kind={kind} />
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [sales, setSales] = useState<DashboardOrder[]>([]);
  const [purchases, setPurchases] = useState<DashboardOrder[]>([]);
  const [listings, setListings] = useState<Product[]>([]);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletCurrency, setWalletCurrency] = useState("RWF");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return observeAuthState((nextUser) => setUser(nextUser));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!user) {
        setSales([]);
        setPurchases([]);
        setListings([]);
        setWalletBalance(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [salesData, purchasesData, listingsData, wallet] = await Promise.all([
          fetchSalesOrders(),
          fetchMyOrders(),
          fetchMyListings().catch(() => [] as Product[]),
          fetchWallet().catch(() => null),
        ]);
        if (cancelled) return;
        setSales(salesData);
        setPurchases(purchasesData);
        setListings(listingsData);
        setWalletBalance(wallet?.walletBalance ?? null);
        setWalletCurrency(wallet?.transactions[0]?.currency ?? "RWF");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load your activity");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const activeListings = listings.filter((p) => p.status === "active").length;
  const inEscrow = [...sales, ...purchases].filter((o) => o.escrowStatus === "held").length;
  const needsPayment = purchases.filter((o) => o.escrowStatus === "pending_payment").length;

  const quickLinks = [
    { href: "/sell/new", label: "Sell a piece", primary: true },
    { href: "/dashboard/storefront", label: "Edit storefront" },
    { href: "/sell/my-listings", label: "My listings" },
    { href: "/my-bids", label: "My bids" },
    { href: "/wallet", label: "Wallet" },
    { href: "/account/verification", label: "Verification" },
  ];

  return (
    <div className="container-page py-10 sm:py-14">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="heading text-2xl text-foreground sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Your sales, purchases, listings and escrow — all at a glance.
          </p>
        </div>
      </div>

      {!user ? (
        <div className="mt-8">
          <EmptyState
            icon="inbox"
            title="Sign in to see your activity"
            description="Your sales, purchases, listings and escrow status will show up here."
          >
            <Link href="/" className="btn btn-primary">
              Sign in
            </Link>
          </EmptyState>
        </div>
      ) : error && !loading ? (
        <p className="mt-8 text-sm text-danger">{error}</p>
      ) : loading ? (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-28 w-full rounded-card" />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card space-y-4 p-6">
              <ListRowSkeleton />
              <ListRowSkeleton />
              <ListRowSkeleton />
            </div>
            <div className="card space-y-4 p-6">
              <ListRowSkeleton />
              <ListRowSkeleton />
              <ListRowSkeleton />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Active listings" value={String(activeListings)} hint={`${listings.length} total`} />
            <StatCard label="In escrow" value={String(inEscrow)} hint="Orders held safely" tone="text-accent-strong" />
            <StatCard
              label="Awaiting your payment"
              value={String(needsPayment)}
              hint={needsPayment > 0 ? "Complete checkout" : "All settled"}
              tone={needsPayment > 0 ? "text-danger" : undefined}
            />
            <StatCard
              label="Wallet"
              value={walletBalance === null ? "—" : formatPrice(walletBalance, walletCurrency)}
              hint="Available balance"
            />
          </div>

          <nav className="mt-6 flex flex-wrap gap-2">
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn("btn", link.primary ? "btn-primary" : "btn-secondary")}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="card p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">My sales</h2>
                <Link href="/sell/my-listings" className="text-xs font-medium text-accent-strong hover:underline">
                  Manage listings
                </Link>
              </div>
              <OrderList orders={sales} kind="sale" />
            </section>
            <section className="card p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">My purchases</h2>
                <Link href="/my-bids" className="text-xs font-medium text-accent-strong hover:underline">
                  View bids
                </Link>
              </div>
              <OrderList orders={purchases} kind="purchase" />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
