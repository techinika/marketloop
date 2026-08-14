"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { formatPrice } from "@/lib/api";
import { adminFetchStats } from "@/lib/admin";
import type { AdminStats } from "@/types";
import { cn } from "@/lib/cn";

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setError(null);
      try {
        const data = await adminFetchStats();
        if (!cancelled) setStats(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load stats");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards: Array<{ label: string; value: string; tone?: string }> = stats
    ? [
        { label: "Active listings", value: String(stats.activeListings) },
        { label: "Orders pending payment", value: String(stats.ordersPendingPayment) },
        { label: "Orders held in escrow", value: String(stats.ordersHeld), tone: "text-accent-strong" },
        {
          label: "Need refund attention",
          value: String(stats.refundAttention),
          tone: stats.refundAttention > 0 ? "text-danger" : undefined,
        },
        { label: "GMV this month (RWF)", value: formatPrice(stats.gmvThisMonth.RWF, "RWF") },
        { label: "GMV this month (USD)", value: formatPrice(stats.gmvThisMonth.USD, "USD") },
      ]
    : [];

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Admin</h1>
      <p className="mt-1 text-sm text-muted">Marketplace oversight, refunds, and user management.</p>

      <nav className="mt-6 flex flex-wrap gap-2">
        <Link href="/admin/orders" className="btn btn-primary">
          Orders
        </Link>
        <Link href="/admin/users" className="btn btn-secondary">
          Users
        </Link>
        <Link href="/admin/verifications" className="btn btn-secondary">
          Verifications
        </Link>
      </nav>

      {error && !stats ? (
        <p className="mt-10 text-sm text-danger">{error}</p>
      ) : !stats ? (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-24 w-full rounded-card" />
          ))}
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {cards.map((card) => (
            <div key={card.label} className="card p-5">
              <p className="text-xs text-muted">{card.label}</p>
              <p className={cn("mt-2 text-2xl font-semibold tracking-tight text-foreground", card.tone)}>
                {card.value}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
