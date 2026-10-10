import type { Metadata } from "next";
import { Suspense } from "react";

import { ExploreFeed } from "@/components/ExploreFeed";
import { filtersFromParams, type ExploreFilters } from "@/lib/exploreFilters";
import { fetchFeed } from "@/lib/products";
import { DUMMY_PRODUCTS } from "@/lib/dummyData";
import { ExploreSkeleton } from "@/components/ui/Skeleton";
import type { ProductFeed } from "@/types";

export const dynamic = "force-dynamic";

/** True when the visitor hasn't narrowed the feed with any filter. */
function isUnfiltered(f: ExploreFilters): boolean {
  return (
    f.search === "" &&
    f.category === "" &&
    f.currency === "" &&
    !f.biddingOnly &&
    f.priceMin === "" &&
    f.priceMax === "" &&
    f.productType === "" &&
    f.tags === "" &&
    f.materials === "" &&
    f.region === ""
  );
}

/**
 * SEO note: filtered /explore pages (e.g. ?category=Fashion) share a single
 * canonical URL pointing at the unfiltered feed. Filter state is kept
 * crawlable but not canonical so we don't create near-duplicate index pages.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const { q } = await searchParams;
  const title = q ? `Search: ${q}` : "Discover handmade Rwandan craft";
  return {
    title,
    description:
      "Browse handmade Rwandan craft — baskets, Imigongo art, wood carvings, jewelry and textiles. Made to order or ready to ship, straight from the artisan.",
    alternates: { canonical: "/explore" },
    openGraph: {
      title,
      description: "Discover handmade Rwandan craft and commissioned art.",
      type: "website",
      url: "/explore",
    },
  };
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") sp.set(key, value);
    else if (value) sp.set(key, value.join(","));
  }
  const filters = filtersFromParams(sp);

  let initial: ProductFeed | null = null;
  try {
    initial = await fetchFeed({
      search: filters.search || undefined,
      category: filters.category || undefined,
      currency: filters.currency || undefined,
      isBiddingEnabled: filters.biddingOnly ? true : undefined,
      priceMin: toNumberSafe(filters.priceMin),
      priceMax: toNumberSafe(filters.priceMax),
      sortBy: filters.sortBy,
      page: 1,
    });
  } catch {
    // API unreachable at request time — the client feed retries on mount.
    initial = null;
  }

  // Show demo pieces only when nothing filtered came back from the database,
  // so the marketplace never looks broken while it's still filling up.
  if (isUnfiltered(filters) && (!initial || initial.products.length === 0)) {
    initial = {
      products: DUMMY_PRODUCTS,
      page: 1,
      pageSize: DUMMY_PRODUCTS.length,
      hasMore: false,
    };
  }

  return (
    <Suspense fallback={<ExploreSkeleton />}>
      <ExploreFeed initialData={initial} initialFilters={filters} />
    </Suspense>
  );
}

function toNumberSafe(value: string): number | undefined {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
