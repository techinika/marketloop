"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { User as FirebaseUser } from "firebase/auth";

import { formatPrice, mediaUrl } from "@/lib/api";
import { observeAuthState } from "@/lib/firebase";
import { fetchMyBids, withdrawBid } from "@/lib/products";
import type { MyBidRow } from "@/types";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRowSkeleton } from "@/components/ui/Skeleton";

const STATUS_BADGE: Record<MyBidRow["status"], { label: string; cls: string }> = {
  active: { label: "Active", cls: "badge-success" },
  withdrawn: { label: "Withdrawn", cls: "badge-neutral" },
  accepted: { label: "Accepted", cls: "badge-accent" },
};

export function MyBidsDashboard() {
  const { toast } = useToast();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [bids, setBids] = useState<MyBidRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    return observeAuthState((nextUser) => {
      setUser(nextUser);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!user) {
        setBids(null);
        return;
      }
      setError(null);
      try {
        const rows = await fetchMyBids();
        if (!cancelled) setBids(rows);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load your bids");
        setBids([]);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleWithdraw = async (bidId: string) => {
    setBusyId(bidId);
    setError(null);
    try {
      await withdrawBid(bidId);
      setBids((prev) =>
        prev ? prev.map((b) => (b.id === bidId ? { ...b, status: "withdrawn" as const } : b)) : prev,
      );
      toast({ title: "Offer withdrawn", variant: "info" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to withdraw");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="container-page max-w-3xl py-8 sm:py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">My Bids</h1>

      {!user ? (
        <div className="mt-8">
          <EmptyState
            icon="inbox"
            title="Sign in to see your offers"
            description="Your bids across the marketplace will show up here."
          >
            <Link href="/" className="btn btn-primary">
              Sign in
            </Link>
          </EmptyState>
        </div>
      ) : bids === null ? (
        <div className="mt-8 flex flex-col gap-4">
          <ListRowSkeleton />
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : bids.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon="search"
            title="No offers yet"
            description="When you make an offer on a listing, it will appear here so you can track and check out."
          >
            <Link href="/explore" className="btn btn-primary">
              Explore listings
            </Link>
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {bids.map((bid) => {
            const meta = STATUS_BADGE[bid.status];
            return (
              <li key={bid.id} className="card flex items-center gap-4 p-4 transition-shadow hover:shadow-lifted">
                {bid.product ? (
                  <Link href={`/product/${bid.product.id}`} className="shrink-0">
                    {bid.product.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mediaUrl(bid.product.images[0])}
                        alt=""
                        className="size-16 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="flex size-16 items-center justify-center rounded-xl bg-surface-muted text-xs text-muted">
                        No image
                      </div>
                    )}
                  </Link>
                ) : (
                  <div className="size-16 shrink-0 rounded-xl bg-surface-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/product/${bid.productId}`}
                    className="block truncate text-sm font-medium text-foreground hover:underline"
                  >
                    {bid.product?.title ?? "Product"}
                  </Link>
                  <p className="mt-1 text-base font-semibold text-foreground">
                    {formatPrice(bid.amount, bid.currency)}
                  </p>
                  <span className={cn("badge mt-1", meta.cls)}>{meta.label}</span>
                </div>
                {bid.status === "active" ? (
                  <button
                    type="button"
                    onClick={() => handleWithdraw(bid.id)}
                    disabled={busyId === bid.id}
                    className="btn btn-secondary shrink-0"
                  >
                    {busyId === bid.id ? "Withdrawing..." : "Withdraw"}
                  </button>
                ) : bid.status === "accepted" ? (
                  <Link
                    href={`/checkout/${bid.productId}?amount=${encodeURIComponent(bid.amount)}&currency=${encodeURIComponent(bid.currency)}`}
                    className="btn btn-primary shrink-0"
                  >
                    Checkout
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
    </div>
  );
}
