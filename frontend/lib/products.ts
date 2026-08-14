import { apiFetch } from "@/lib/api";
import { publicFetch } from "@/lib/publicApi";
import type {
  Bid,
  BidSummary,
  CheckoutInfo,
  Currency,
  DeliveryFeePayer,
  FeedSortBy,
  MyBidRow,
  Product,
  ProductDetail,
  ProductFeed,
  SellerBidRow,
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
  params.set("page", String(filters.page ?? 1));
  params.set("pageSize", String(filters.pageSize ?? 20));
  const qs = params.toString();
  return publicFetch<ProductFeed>(`/products${qs ? `?${qs}` : ""}`);
}

/** Public product detail + seller summary. */
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

/** Seller-only: all active bids with buyer info. */
export async function fetchSellerBids(productId: string): Promise<SellerBidRow[]> {
  const res = await apiFetch<{ bids: SellerBidRow[] }>(
    `/products/${encodeURIComponent(productId)}/bids/all`,
  );
  return res.bids;
}

/** Seller accepts a bid; product is reserved and checkout info is returned. */
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

/** The seller's own listings (all statuses). */
export async function fetchMyListings(): Promise<Product[]> {
  const res = await apiFetch<{ products: Product[] }>("/products/mine");
  return res.products;
}
