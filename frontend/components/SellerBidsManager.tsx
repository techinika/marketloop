"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { User as FirebaseUser } from "firebase/auth";

import { formatPrice } from "@/lib/api";
import { observeAuthState } from "@/lib/firebase";
import { acceptBid, fetchProduct, fetchSellerBids } from "@/lib/products";
import type { Product, SellerBidRow } from "@/types";
import { useToast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRowSkeleton } from "@/components/ui/Skeleton";

export function SellerBidsManager() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { toast } = useToast();

  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [bids, setBids] = useState<SellerBidRow[] | null>(null);
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
        setProduct(null);
        setBids(null);
        return;
      }
      setError(null);
      try {
        const detail = await fetchProduct(id);
        const rows = await fetchSellerBids(id);
        if (cancelled) return;
        setProduct(detail.product);
        setBids(rows);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load offers");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user, id]);

  const handleAccept = async (bidId: string) => {
    setBusyId(bidId);
    setError(null);
    try {
      const { product: updatedProduct, checkout } = await acceptBid(bidId);
      setProduct(updatedProduct);
      setBids([]);
      toast({
        title: "Offer accepted",
        description: `${formatPrice(checkout.amount, checkout.currency)} — the item is reserved while the buyer pays.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept offer");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="container-page max-w-3xl py-8 sm:py-12">
      <Link
        href="/sell/my-listings"
        className="text-sm font-medium text-secondary transition-colors hover:text-foreground"
      >
        &larr; My listings
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {product ? product.title : "Offers"}
      </h1>
      {product && (
        <p className="mt-1 text-sm text-secondary">
          {product.isBiddingEnabled ? "Bidding" : "Direct sale"} ·{" "}
          <span className="font-medium text-foreground">
            {formatPrice(product.priceAmount, product.priceCurrency)}
          </span>
        </p>
      )}

      {!user ? (
        <div className="mt-8">
          <EmptyState
            icon="inbox"
            title="Sign in to manage offers"
            description="You need to sign in to accept offers on your listing."
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
        </div>
      ) : product?.status === "reserved" ? (
        <div className="card mt-6 bg-warning-soft p-4 text-sm text-warning">
          This item is reserved. The buyer has time to pay; it will return to active if they
          don&apos;t.
        </div>
      ) : bids.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon="search"
            title="No active offers"
            description="When buyers make offers on this listing, they'll appear here sorted by amount."
          />
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {bids.map((bid, index) => (
            <li key={bid.id} className="card flex items-center gap-4 p-4 transition-shadow hover:shadow-lifted">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-strong">
                {index + 1}
              </span>
              {bid.buyer.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={bid.buyer.photoUrl}
                  alt=""
                  className="size-11 shrink-0 rounded-full border border-border object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="size-11 shrink-0 rounded-full bg-accent-soft" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{bid.buyer.name}</p>
                <p className="text-base font-semibold text-foreground">
                  {formatPrice(bid.amount, bid.currency)}
                </p>
                <p className="text-xs text-muted">
                  {new Date(bid.createdAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleAccept(bid.id)}
                disabled={busyId === bid.id}
                className="btn btn-primary shrink-0"
              >
                {busyId === bid.id ? "Accepting..." : "Accept"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
    </div>
  );
}
