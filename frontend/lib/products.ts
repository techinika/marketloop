import { apiFetch } from "@/lib/api";
import { publicFetch } from "@/lib/publicApi";
import type {
  ArtisanProfile,
  ArtisanStorefront,
  Bid,
  BidSummary,
  CheckoutInfo,
  Currency,
  CustomizationOption,
  DeliveryFeePayer,
  FeedSortBy,
  MyBidRow,
  Product,
  ProductDetail,
  ProductFeed,
  ProductStatus,
  ProductType,
  ArtisanBidRow,
} from "@/types";

export interface ProductInput {
  title: string;
  description: string;
  category: string;
  priceAmount: number;
  priceCurrency: Currency;
  isNegotiable: boolean;
  isBiddingEnabled: boolean;
  conditionNote: string;
  images: string[];
  videoUrl: string | null;
  deliveryFee: number;
  deliveryFeePayer: DeliveryFeePayer;
  /** Immutable listing kind chosen at creation. */
  productType: ProductType;
  /** Free-text discovery labels (e.g. "sisal", "wedding"). */
  tags: string[];
  /** Materials used in the piece (e.g. "Banana Fiber"). */
  materials: string[];
  /** Region/province the piece is made in. */
  region: string | null;
  /** Made-to-order: units in stock is meaningless; always 0. */
  quantityAvailable: number;
  /** Made-to-order only: estimated days to make this piece (1-365). */
  productionTimeDays: number;
  /** Made-to-order only: whether buyers answer structured customization questions. */
  isCustomizable: boolean;
  /** Made-to-order only: structured questions; validated only when isCustomizable. */
  customizationOptions: CustomizationOption[];
  /** Made-to-order only: lets the buyer attach a reference image + free-text brief. */
  allowsReferenceUpload: boolean;
}

export interface FeedFilters {
  category?: string;
  currency?: Currency;
  isBiddingEnabled?: boolean;
  /** Free-text keyword search against the title (case-insensitive). */
  search?: string;
  priceMin?: number;
  priceMax?: number;
  sortBy?: FeedSortBy;
  /** One listing kind or the other. */
  productType?: ProductType;
  /** Discovery tags (OR match, up to 10). */
  tags?: string[];
  /** Materials (OR match, up to 10). */
  materials?: string[];
  /** Region/province equality match. */
  region?: string;
  page?: number;
  pageSize?: number;
}

/** Creates a product listing (requires auth). Returns the created product. */
export async function createProduct(input: ProductInput): Promise<Product> {
  const res = await apiFetch<{ product: Product }>("/products", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.product;
}

/** Public Explore feed with filters + pagination. */
export async function fetchFeed(filters: FeedFilters = {}): Promise<ProductFeed> {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  if (filters.currency) params.set("currency", filters.currency);
  if (filters.isBiddingEnabled !== undefined) {
    params.set("isBiddingEnabled", String(filters.isBiddingEnabled));
  }
  if (filters.search) params.set("search", filters.search);
  if (filters.priceMin !== undefined) params.set("priceMin", String(filters.priceMin));
  if (filters.priceMax !== undefined) params.set("priceMax", String(filters.priceMax));
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.productType) params.set("productType", filters.productType);
  if (filters.tags?.length) params.set("tags", filters.tags.join(","));
  if (filters.materials?.length) params.set("materials", filters.materials.join(","));
  if (filters.region) params.set("region", filters.region);
  params.set("page", String(filters.page ?? 1));
  params.set("pageSize", String(filters.pageSize ?? 20));
  const qs = params.toString();
  return publicFetch<ProductFeed>(`/products${qs ? `?${qs}` : ""}`);
}

/** Public artisan storefront: profile + active listings. */
export async function fetchArtisanProfile(uid: string, opts?: { page?: number; pageSize?: number }): Promise<ArtisanProfile> {
  const params = new URLSearchParams();
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.pageSize) params.set("pageSize", String(opts.pageSize));
  const qs = params.size > 0 ? `?${params.toString()}` : "";
  return publicFetch<ArtisanProfile>(`/artisans/${encodeURIComponent(uid)}${qs}`);
}

/** A short, ranked list of shops for the homepage "featured artisans" row. */
export async function fetchArtisans(limit = 8): Promise<ArtisanStorefront[]> {
  const res = await publicFetch<{ artisans: ArtisanStorefront[] }>(
    `/artisans?limit=${limit}`,
  );
  return res.artisans;
}

export interface ArtisanProfileInput {
  storeName?: string | null;
  storeBio?: string | null;
  storeRegion?: string | null;
  specialties?: string[];
}

/** PATCH /artisans/me — the caller updates their public storefront profile. */
export async function updateArtisanProfile(
  input: ArtisanProfileInput,
): Promise<Pick<ArtisanStorefront, "uid" | "name" | "photoUrl" | "storeName" | "storeBio" | "storeRegion" | "specialties">> {
  const res = await apiFetch<{ user: Pick<ArtisanStorefront, "uid" | "name" | "photoUrl" | "storeName" | "storeBio" | "storeRegion" | "specialties"> }>("/artisans/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return res.user;
}

/** Public product detail + artisan summary. */
export async function fetchProduct(id: string): Promise<ProductDetail> {
  return publicFetch<ProductDetail>(`/products/${encodeURIComponent(id)}`);
}

/** Public bid summary (count + highest). */
export async function fetchBidSummary(productId: string): Promise<BidSummary> {
  return publicFetch<BidSummary>(`/products/${encodeURIComponent(productId)}/bids`);
}

/** Creates or updates the caller's active bid. */
export async function placeBid(productId: string, amount: number): Promise<Bid> {
  const res = await apiFetch<{ bid: Bid }>(`/products/${encodeURIComponent(productId)}/bids`, {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
  return res.bid;
}

/** The caller's own active bid on a product, if any. */
export async function fetchMyBid(productId: string): Promise<Bid | null> {
  const res = await apiFetch<{ bid: Bid | null }>(
    `/products/${encodeURIComponent(productId)}/bids/mine`,
  );
  return res.bid;
}

/** Artisan-only: all active bids with buyer info. */
export async function fetchArtisanBids(productId: string): Promise<ArtisanBidRow[]> {
  const res = await apiFetch<{ bids: ArtisanBidRow[] }>(
    `/products/${encodeURIComponent(productId)}/bids/all`,
  );
  return res.bids;
}

/** Artisan accepts a bid; product is reserved and checkout info is returned. */
export async function acceptBid(bidId: string): Promise<{ product: Product; checkout: CheckoutInfo }> {
  return apiFetch<{ product: Product; checkout: CheckoutInfo }>(`/bids/${encodeURIComponent(bidId)}/accept`, {
    method: "POST",
  });
}

/** Buyer withdraws their own active bid. */
export async function withdrawBid(bidId: string): Promise<Bid> {
  const res = await apiFetch<{ bid: Bid }>(`/bids/${encodeURIComponent(bidId)}/withdraw`, {
    method: "POST",
  });
  return res.bid;
}

/** Buyer's own bids across products (dashboard). */
export async function fetchMyBids(): Promise<MyBidRow[]> {
  const res = await apiFetch<{ bids: MyBidRow[] }>("/bids/mine");
  return res.bids;
}

/** Direct buy on a non-bidding product: reserves it and returns checkout info. */
export async function reserveProduct(productId: string): Promise<{ product: Product; checkout: CheckoutInfo }> {
  return apiFetch<{ product: Product; checkout: CheckoutInfo }>(
    `/products/${encodeURIComponent(productId)}/reserve`,
    { method: "POST" },
  );
}

/** The artisan's own listings (all statuses). */
export async function fetchMyListings(): Promise<Product[]> {
  const res = await apiFetch<{ products: Product[] }>("/products/mine");
  return res.products;
}

/** Fields an artisan may change after creating a listing. */
export interface ProductUpdateInput {
  title?: string;
  description?: string;
  category?: string;
  priceAmount?: number;
  priceCurrency?: Currency;
  isNegotiable?: boolean;
  isBiddingEnabled?: boolean;
  conditionNote?: string;
  images?: string[];
  videoUrl?: string | null;
  deliveryFee?: number;
  deliveryFeePayer?: DeliveryFeePayer;
  tags?: string[];
  materials?: string[];
  region?: string | null;
  isCustomizable?: boolean;
  /** Ready-to-ship only: units in stock (0 => sold out). */
  quantityAvailable?: number;
  /** Made-to-order only: estimated days to make the piece (1-365). */
  productionTimeDays?: number;
  /** Made-to-order only: structured customization questions. */
  customizationOptions?: CustomizationOption[];
  /** Made-to-order only: allow a reference image + free-text brief. */
  allowsReferenceUpload?: boolean;
  /** Made-to-order only: cap on concurrent open orders; null = unlimited. */
  maxConcurrentOrders?: number | null;
  /** Made-to-order only: whether to accept new orders (false also pauses). */
  acceptingOrders?: boolean;
  status?: ProductStatus;
}

/** PATCH /products/:id — the artisan edits one of their own listings. */
export async function updateProduct(id: string, input: ProductUpdateInput): Promise<Product> {
  const res = await apiFetch<{ product: Product }>(`/products/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return res.product;
}
