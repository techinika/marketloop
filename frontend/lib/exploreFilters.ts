import type { Currency, FeedSortBy } from "@/types";

/** Serializable filter state for the Explore feed (shared server + client). */
export interface ExploreFilters {
  search: string;
  category: string;
  currency: Currency | "";
  biddingOnly: boolean;
  priceMin: string;
  priceMax: string;
  sortBy: FeedSortBy;
}

export const DEFAULT_FILTERS: ExploreFilters = {
  search: "",
  category: "",
  currency: "",
  biddingOnly: false,
  priceMin: "",
  priceMax: "",
  sortBy: "newest",
};

export const SORTS: Array<{ value: FeedSortBy; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

/** Parses /explore query params into filter state. */
export function filtersFromParams(sp: URLSearchParams): ExploreFilters {
  const sort = sp.get("sort");
  return {
    search: sp.get("q") ?? "",
    category: sp.get("category") ?? "",
    currency: (sp.get("currency") as Currency | "") ?? "",
    biddingOnly: sp.get("bidding") === "1",
    priceMin: sp.get("priceMin") ?? "",
    priceMax: sp.get("priceMax") ?? "",
    sortBy: SORTS.some((s) => s.value === sort) ? (sort as FeedSortBy) : "newest",
  };
}

/** Serializes filter state back into /explore query params. */
export function paramsFromFilters(f: ExploreFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.search.trim()) params.set("q", f.search.trim());
  if (f.category) params.set("category", f.category);
  if (f.currency) params.set("currency", f.currency);
  if (f.biddingOnly) params.set("bidding", "1");
  if (f.priceMin.trim()) params.set("priceMin", f.priceMin.trim());
  if (f.priceMax.trim()) params.set("priceMax", f.priceMax.trim());
  if (f.sortBy !== "newest") params.set("sort", f.sortBy);
  return params;
}

export function toNumber(value: string): number | undefined {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function filtersEqual(a: ExploreFilters, b: ExploreFilters): boolean {
  return (
    a.search === b.search &&
    a.category === b.category &&
    a.currency === b.currency &&
    a.biddingOnly === b.biddingOnly &&
    a.priceMin === b.priceMin &&
    a.priceMax === b.priceMax &&
    a.sortBy === b.sortBy
  );
}
