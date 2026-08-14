"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { formatPrice, mediaUrl } from "@/lib/publicApi";
import { fetchFeed } from "@/lib/products";
import {
  DEFAULT_FILTERS,
  filtersEqual,
  filtersFromParams,
  paramsFromFilters,
  SORTS,
  toNumber,
  type ExploreFilters,
} from "@/lib/exploreFilters";
import {
  CATEGORIES,
  type Currency,
  type FeedSortBy,
  type Product,
  type ProductFeed,
} from "@/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProductCardSkeleton } from "@/components/ui/Skeleton";

const selectClass = "field h-10 rounded-full px-4";

export function ExploreFeed({
  initialData = null,
  initialFilters = null,
}: {
  /** Server-rendered page-1 feed; skipped on mount when it matches the URL. */
  initialData?: ProductFeed | null;
  initialFilters?: ExploreFilters | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<ExploreFilters>(() =>
    filtersFromParams(searchParams),
  );
  const hydrated = useRef(false);

  const [products, setProducts] = useState<Product[]>(initialData?.products ?? []);
  const [page, setPage] = useState(initialData?.page ?? 1);
  const [hasMore, setHasMore] = useState(initialData?.hasMore ?? false);
  const [loading, setLoading] = useState(!initialData);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search box so we don't fire a request per keystroke.
  const [searchInput, setSearchInput] = useState(filters.search);
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => {
        const next = { ...prev, search: searchInput.trim() };
        return filtersEqual(prev, next) ? prev : next;
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const set = <K extends keyof ExploreFilters>(key: K, value: ExploreFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  // Keep the URL in sync so filters are shareable/bookmarkable.
  useEffect(() => {
    const params = paramsFromFilters(filters);
    const qs = params.toString();
    router.replace(qs ? `/explore?${qs}` : "/explore", { scroll: false });
  }, [filters, router]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // Server already rendered this exact page — skip the duplicate fetch.
      if (
        !hydrated.current &&
        initialData &&
        initialFilters &&
        filtersEqual(filters, initialFilters)
      ) {
        hydrated.current = true;
        return;
      }
      hydrated.current = true;
      setLoading(true);
      setError(null);
      try {
        const feed = await fetchFeed({
          search: filters.search || undefined,
          category: filters.category || undefined,
          currency: filters.currency || undefined,
          isBiddingEnabled: filters.biddingOnly ? true : undefined,
          priceMin: toNumber(filters.priceMin),
          priceMax: toNumber(filters.priceMax),
          sortBy: filters.sortBy,
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
  }, [filters, initialData, initialFilters]);

  const handleLoadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const nextPage = page + 1;
      const feed = await fetchFeed({
        search: filters.search || undefined,
        category: filters.category || undefined,
        currency: filters.currency || undefined,
        isBiddingEnabled: filters.biddingOnly ? true : undefined,
        priceMin: toNumber(filters.priceMin),
        priceMax: toNumber(filters.priceMax),
        sortBy: filters.sortBy,
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

  const clearAll = () => {
    setSearchInput("");
    setFilters(DEFAULT_FILTERS);
  };

  const activeCount =
    (filters.search !== "" ? 1 : 0) +
    (filters.category !== "" ? 1 : 0) +
    (filters.currency !== "" ? 1 : 0) +
    (filters.biddingOnly ? 1 : 0) +
    (filters.priceMin !== "" || filters.priceMax !== "" ? 1 : 0);

  return (
    <div className="container-page py-8 sm:py-12">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Explore
        </h1>
        <div className="relative">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search items..."
            aria-label="Search items"
            className="field h-10 w-56 rounded-full pl-10 sm:w-64"
          />
        </div>
        <select
          value={filters.category}
          onChange={(e) => set("category", e.target.value)}
          className={selectClass}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={filters.currency}
          onChange={(e) => set("currency", e.target.value as Currency | "")}
          className={selectClass}
        >
          <option value="">All currencies</option>
          <option value="RWF">RWF</option>
          <option value="USD">USD</option>
        </select>
        <select
          value={filters.sortBy}
          onChange={(e) => set("sortBy", e.target.value as FeedSortBy)}
          className={selectClass}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-medium text-secondary transition-colors hover:bg-surface-muted">
          <input
            type="checkbox"
            checked={filters.biddingOnly}
            onChange={(e) => set("biddingOnly", e.target.checked)}
            className="size-4 rounded border-border accent-accent"
          />
          Bidding only
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={filters.priceMin}
            onChange={(e) => set("priceMin", e.target.value)}
            placeholder="Min price"
            aria-label="Minimum price"
            className="field h-9 w-32 rounded-full px-4"
          />
          <span className="text-sm text-muted">to</span>
          <input
            type="number"
            min={0}
            value={filters.priceMax}
            onChange={(e) => set("priceMax", e.target.value)}
            placeholder="Max price"
            aria-label="Maximum price"
            className="field h-9 w-32 rounded-full px-4"
          />
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-sm font-medium text-accent transition-colors hover:text-accent-strong"
          >
            Clear all ({activeCount})
          </button>
        )}
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
            title={activeCount > 0 ? "Nothing matches those filters" : "No products yet"}
            description={
              activeCount > 0
                ? "Try different keywords, widen the price range or turn off a filter."
                : "Be the first to list something — it takes under a minute."
            }
          >
            {activeCount > 0 ? (
              <button
                type="button"
                onClick={clearAll}
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
          <Image
            src={mediaUrl(cover)}
            alt={product.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
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
