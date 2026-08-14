"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { User as FirebaseUser } from "firebase/auth";

import { formatPrice } from "@/lib/api";
import { observeAuthState } from "@/lib/firebase";
import { fetchMyOrders, fetchSalesOrders } from "@/lib/orders";
import type { DashboardOrder, EscrowStatus } from "@/types";
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

function OrderList({ orders, kind }: { orders: DashboardOrder[]; kind: "sale" | "purchase" }) {
  if (orders.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          icon="inbox"
          title={kind === "sale" ? "No sales yet" : "No purchases yet"}
          description={
            kind === "sale"
              ? "List a product to start selling on the marketplace."
              : "Explore the marketplace to find something you love."
          }
        />
      </div>
    );
  }

  return (
    <ul className="mt-2 flex flex-col divide-y divide-border">
      {orders.map((order) => {
        const badge = STATUS_BADGE[order.escrowStatus];
        return (
          <li key={order.id} className="py-3">
            <Link
              href={`/orders/${order.id}`}
              className="flex items-center justify-between gap-3 rounded-lg px-1 py-1 transition-colors hover:bg-surface-muted"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{order.product?.title ?? "Product removed"}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {formatDate(order.createdAt)}
                  {kind === "sale" && order.buyer?.name && ` · ${order.buyer.name}`}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-foreground">{formatPrice(order.totalPaid, order.currency)}</p>
                <div className="mt-1 flex items-center justify-end gap-1.5">
                  {order.hasDispute === true && <span className="badge badge-danger">Under review</span>}
                  <span className={cn("badge", badge.cls)}>{badge.label}</span>
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function DashboardPage() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [sales, setSales] = useState<DashboardOrder[]>([]);
  const [purchases, setPurchases] = useState<DashboardOrder[]>([]);
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
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [salesData, purchasesData] = await Promise.all([fetchSalesOrders(), fetchMyOrders()]);
        if (cancelled) return;
        setSales(salesData);
        setPurchases(purchasesData);
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

  return (
    <div className="container-page py-10 sm:py-14">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Your sales, purchases, and escrow status at a glance.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/my-bids" className="btn btn-secondary">
            My bids
          </Link>
          <Link href="/wallet" className="btn btn-primary">
            Wallet
          </Link>
        </div>
      </div>

      {!user ? (
        <div className="mt-8">
          <EmptyState
            icon="inbox"
            title="Sign in to see your activity"
            description="Your sales, purchases, and escrow status will show up here."
          >
            <Link href="/" className="btn btn-primary">
              Sign in
            </Link>
          </EmptyState>
        </div>
      ) : error && !loading ? (
        <p className="mt-8 text-sm text-danger">{error}</p>
      ) : loading ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
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
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="card p-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">My sales</h2>
            <OrderList orders={sales} kind="sale" />
          </section>
          <section className="card p-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">My purchases</h2>
            <OrderList orders={purchases} kind="purchase" />
          </section>
        </div>
      )}
    </div>
  );
}
