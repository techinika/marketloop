"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { formatPrice, mediaUrl } from "@/lib/api";
import { fetchFeed } from "@/lib/products";
import { CATEGORIES, type Currency, type Product } from "@/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProductCardSkeleton } from "@/components/ui/Skeleton";

const selectClass =
  "field h-10 rounded-full px-4";

export function ExploreFeed() {
  const [category, setCategory] = useState<string>("");
  const [currency, setCurrency] = useState<Currency | "">("");
  const [biddingOnly, setBiddingOnly] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const feed = await fetchFeed({
          category: category || undefined,
          currency: currency || undefined,
          isBiddingEnabled: biddingOnly ? true : undefined,
          page: 1,
        });
        if (cancelled) return;
        setProducts(feed.products);
        setPage(feed.page);
        setHasMore(feed.hasMore);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load products");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [category, currency, biddingOnly]);

  const handleLoadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const nextPage = page + 1;
      const feed = await fetchFeed({
        category: category || undefined,
        currency: currency || undefined,
        isBiddingEnabled: biddingOnly ? true : undefined,
        page: nextPage,
      });
      setProducts((prev) => [...prev, ...feed.products]);
      setPage(feed.page);
      setHasMore(feed.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more products");
    } finally {
      setLoadingMore(false);
    }
  };

  const hasFilters = category !== "" || currency !== "" || biddingOnly;

  return (
    <div className="container-page py-8 sm:py-12">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Explore
        </h1>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectClass}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value as Currency | "")}
          className={selectClass}
        >
          <option value="">All currencies</option>
          <option value="RWF">RWF</option>
          <option value="USD">USD</option>
        </select>
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-medium text-secondary transition-colors hover:bg-surface-muted">
          <input
            type="checkbox"
            checked={biddingOnly}
            onChange={(e) => setBiddingOnly(e.target.checked)}
            className="size-4 rounded border-border accent-accent"
          />
          Bidding only
        </label>
      </div>

      {error && !loading && (
        <p className="card mt-6 bg-danger-soft p-4 text-sm text-danger">{error}</p>
      )}

      {loading ? (
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon="search"
            title={hasFilters ? "Nothing matches those filters" : "No products yet"}
            description={
              hasFilters
                ? "Try a different category, currency or turn off bidding-only."
                : "Be the first to list something — it takes under a minute."
            }
          >
            {hasFilters ? (
              <button
                type="button"
                onClick={() => {
                  setCategory("");
                  setCurrency("");
                  setBiddingOnly(false);
                }}
                className="btn btn-secondary"
              >
                Clear filters
              </button>
            ) : (
              <Link href="/sell/new" className="btn btn-primary">
                List an item
              </Link>
            )}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-10 flex justify-center">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="btn btn-secondary px-7"
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ProductCard({ product }: { product: Product }) {
  const cover = product.images[0];

  return (
    <Link
      href={`/product/${product.id}`}
      className="card-interactive group flex flex-col overflow-hidden"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-surface-muted">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl(cover)}
            alt={product.title}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-sm text-muted">
            No image
          </div>
        )}
        <div className="absolute left-3 top-3 flex gap-2">
          {product.isBiddingEnabled && <span className="badge badge-info bg-white/90">Bidding</span>}
          {product.isNegotiable && (
            <span className="badge badge-neutral bg-white/90">Negotiable</span>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="line-clamp-1 text-base font-medium text-foreground">{product.title}</p>
        <p className="text-lg font-semibold text-foreground">
          {formatPrice(product.priceAmount, product.priceCurrency)}
        </p>
        <p className="mt-auto text-xs text-muted">{product.conditionNote || product.category}</p>
      </div>
    </Link>
  );
}
