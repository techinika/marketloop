import type { Currency, FeedSortBy, ProductType } from "@/types";

/** Serializable filter state for the Explore feed (shared server + client). */
export interface ExploreFilters {
  search: string;
  category: string;
  currency: Currency | "";
  biddingOnly: boolean;
  priceMin: string;
  priceMax: string;
  sortBy: FeedSortBy;
  /** One of the two listing kinds, or "" for all. */
  productType: ProductType | "";
  /** Comma-separated discovery tags. */
  tags: string;
  /** Comma-separated materials. */
  materials: string;
  /** Region/province. */
  region: string;
}

export const DEFAULT_FILTERS: ExploreFilters = {
  search: "",
  category: "",
  currency: "",
  biddingOnly: false,
  priceMin: "",
  priceMax: "",
  sortBy: "newest",
  productType: "",
  tags: "",
  materials: "",
  region: "",
};

export const SORTS: Array<{ value: FeedSortBy; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

/** Parses /explore query params into filter state. */
export function filtersFromParams(sp: URLSearchParams): ExploreFilters {
  const sort = sp.get("sort");
  const productType = sp.get("type");
  return {
    search: sp.get("q") ?? "",
    category: sp.get("category") ?? "",
    currency: (sp.get("currency") as Currency | "") ?? "",
    biddingOnly: sp.get("bidding") === "1",
    priceMin: sp.get("priceMin") ?? "",
    priceMax: sp.get("priceMax") ?? "",
    sortBy: SORTS.some((s) => s.value === sort) ? (sort as FeedSortBy) : "newest",
    productType:
      productType === "made_to_order" || productType === "ready_to_ship" ? productType : "",
    tags: sp.get("tags") ?? "",
    materials: sp.get("materials") ?? "",
    region: sp.get("region") ?? "",
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
  if (f.productType) params.set("type", f.productType);
  if (f.tags.trim()) params.set("tags", f.tags.trim());
  if (f.materials.trim()) params.set("materials", f.materials.trim());
  if (f.region.trim()) params.set("region", f.region.trim());
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
    a.sortBy === b.sortBy &&
    a.productType === b.productType &&
    a.tags === b.tags &&
    a.materials === b.materials &&
    a.region === b.region
  );
}

/** Splits a comma/newline-separated string into trimmed, de-duplicated values. */
export function splitList(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]+/).map((v) => v.trim()).filter(Boolean)));
}

/** Maps filter state onto the backend FeedFilters. */
export function toFeedFilters(f: ExploreFilters, page = 1) {
  return {
    search: f.search || undefined,
    category: f.category || undefined,
    currency: f.currency || undefined,
    isBiddingEnabled: f.biddingOnly,
    priceMin: toNumber(f.priceMin),
    priceMax: toNumber(f.priceMax),
    sortBy: f.sortBy,
    productType: f.productType || undefined,
    tags: splitList(f.tags),
    materials: splitList(f.materials),
    region: f.region || undefined,
    page,
  };
}
