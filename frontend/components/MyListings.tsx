"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { User as FirebaseUser } from "firebase/auth";

import { formatPrice, mediaUrl } from "@/lib/api";
import { observeAuthState } from "@/lib/firebase";
import { fetchMyListings } from "@/lib/products";
import type { Product } from "@/types";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRowSkeleton } from "@/components/ui/Skeleton";

const STATUS_BADGE: Record<Product["status"], { label: string; cls: string }> = {
  active: { label: "Active", cls: "badge-success" },
  reserved: { label: "Reserved", cls: "badge-warning" },
  sold: { label: "Sold", cls: "badge-neutral" },
  removed: { label: "Removed", cls: "badge-neutral" },
};

export function MyListings() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return observeAuthState((nextUser) => {
      setUser(nextUser);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!user) {
        setProducts(null);
        return;
      }
      setError(null);
      try {
        const rows = await fetchMyListings();
        if (!cancelled) setProducts(rows);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load your listings");
        setProducts([]);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="container-page max-w-3xl py-8 sm:py-12">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            My Listings
          </h1>
          <p className="mt-1 text-sm text-muted">Everything you&apos;ve listed on MarketLoop.</p>
        </div>
        <Link href="/sell/new" className="btn btn-primary">
          New listing
        </Link>
      </div>

      {!user ? (
        <div className="mt-8">
          <EmptyState
            icon="inbox"
            title="Sign in to see your listings"
            description="Your products and their statuses will show up here."
          >
            <Link href="/" className="btn btn-primary">
              Sign in
            </Link>
          </EmptyState>
        </div>
      ) : products === null ? (
        <div className="mt-8 flex flex-col gap-4">
          <ListRowSkeleton />
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : products.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon="package"
            title="Nothing listed yet"
            description="List your first item — it only takes a minute and is free."
          >
            <Link href="/sell/new" className="btn btn-primary">
              List an item
            </Link>
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {products.map((product) => {
            const meta = STATUS_BADGE[product.status];
            return (
              <li key={product.id} className="card flex items-center gap-4 p-4 transition-shadow hover:shadow-lifted">
                <Link href={`/product/${product.id}`} className="shrink-0">
                  {product.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(product.images[0])}
                      alt=""
                      className="size-16 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex size-16 items-center justify-center rounded-xl bg-surface-muted text-xs text-muted">
                      No image
                    </div>
                  )}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/product/${product.id}`}
                    className="block truncate text-sm font-medium text-foreground hover:underline"
                  >
                    {product.title}
                  </Link>
                  <p className="mt-1 text-base font-semibold text-foreground">
                    {formatPrice(product.priceAmount, product.priceCurrency)}
                  </p>
                  <span className={cn("badge mt-1", meta.cls)}>{meta.label}</span>
                </div>
                {product.isBiddingEnabled && product.status === "active" && (
                  <Link
                    href={`/sell/my-listings/${product.id}/bids`}
                    className="btn btn-secondary shrink-0"
                  >
                    Manage offers
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
    </div>
  );
}
