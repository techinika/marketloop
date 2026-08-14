import type { Metadata } from "next";
import { Suspense } from "react";

import { ExploreFeed } from "@/components/ExploreFeed";
import { filtersFromParams } from "@/lib/exploreFilters";
import { fetchFeed } from "@/lib/products";
import { ExploreSkeleton } from "@/components/ui/Skeleton";

export const dynamic = "force-dynamic";

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
  const title = q ? `Search: ${q} — MarketLoop` : "Explore second-hand goods — MarketLoop";
  return {
    title,
    description:
      "Browse used phones, electronics, furniture and more in Rwanda. Every payment is held in escrow until delivery is confirmed.",
    alternates: { canonical: "/explore" },
    openGraph: {
      title,
      description: "Browse used goods in Rwanda with escrow-protected payments.",
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

  let initial = null;
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
