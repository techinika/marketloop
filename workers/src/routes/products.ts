import { Hono } from "hono";

import { RESERVATION_HOLD_MS, refreshExpiredReservation } from "../lib/bids";
import { cacheGet, cachePut } from "../lib/cache";
import { firestoreFromEnv, type QueryFilter } from "../lib/firestore";
import { httpError } from "../lib/http";
import { titleKeywords } from "../lib/title-keywords";
import {
  asBoolean,
  asNumber,
  asOneOf,
  asString,
  BadRequestError,
} from "../lib/validation";
import { authMiddleware } from "../middleware/auth";
import {
  CATEGORIES,
  collections,
  type Currency,
  type DeliveryFeePayer,
  type Product,
  type ProductStatus,
  type User,
} from "../models";
import type { AppEnv } from "../types";

export const productRoutes = new Hono<AppEnv>();

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 2000;
const MAX_CONDITION_NOTE = 100;
const MAX_MEDIA_KEY = 200;
const MAX_PRICE = 999_999_999;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

function asCategory(value: unknown): string {
  return asOneOf(value, "category", CATEGORIES as readonly string[]);
}

function asCurrency(value: unknown): Currency {
  return asOneOf(value, "priceCurrency", ["USD", "RWF"] as const);
}

function asDeliveryFeePayer(value: unknown): DeliveryFeePayer {
  return asOneOf(value, "deliveryFeePayer", ["seller", "buyer"] as const);
}

function asStatus(value: unknown): ProductStatus {
  return asOneOf(value, "status", ["active", "sold", "reserved", "removed"] as const);
}

const SORTS = ["newest", "price_asc", "price_desc"] as const;
type SortBy = (typeof SORTS)[number];

function asSortBy(value: unknown): SortBy | null {
  if (value === undefined || value === "") return null;
  return asOneOf(value, "sortBy", SORTS);
}

/**
 * Lowercased, deduped title words (length >= 2) used for Firestore prefix
 * search via `array-contains-any` on the `titleKeywords` field. Punctuation is
 * dropped so "iPhone 12" -> ["iphone", "12"]. This is deliberately simple
 * (exact keyword membership); Algolia/Typesense are the upgrade path if it
 * ever becomes insufficient.
 */
function asPriceBound(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestError("priceMin and priceMax must be non-negative numbers");
  }
  return parsed;
}

function asImages(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) {
    throw new BadRequestError("images must be an array of 1-6 media keys");
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.length < 1 || item.length > MAX_MEDIA_KEY) {
      throw new BadRequestError(`images[${index}] is invalid`);
    }
    return item;
  });
}

function asMediaKey(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_MEDIA_KEY) {
    throw new BadRequestError("videoUrl must be a media key or null");
  }
  return value;
}

productRoutes.post("/", authMiddleware, async (c) => {
  const user = c.get("user");

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return httpError(c, 400, "Invalid JSON body");
  }

  try {
    const now = new Date().toISOString();
    const title = asString(body.title, "title", MAX_TITLE);
    const product: Product = {
      sellerId: user.uid,
      title,
      description: asString(body.description, "description", MAX_DESCRIPTION),
      category: asCategory(body.category),
      titleKeywords: titleKeywords(title),
      priceAmount: asNumber(body.priceAmount, "priceAmount", 0.01, MAX_PRICE),
      priceCurrency: asCurrency(body.priceCurrency),
      isNegotiable: asBoolean(body.isNegotiable, "isNegotiable", false),
      isBiddingEnabled: asBoolean(body.isBiddingEnabled, "isBiddingEnabled", false),
      conditionNote: asString(body.conditionNote, "conditionNote", MAX_CONDITION_NOTE, 0),
      images: asImages(body.images),
      videoUrl: asMediaKey(body.videoUrl ?? null),
      deliveryFee: asNumber(body.deliveryFee, "deliveryFee", 0, MAX_PRICE),
      deliveryFeePayer: asDeliveryFeePayer(body.deliveryFeePayer),
      status: "active",
      reservedBy: null,
      reservedUntil: null,
      createdAt: now,
      updatedAt: now,
    };
    const db = firestoreFromEnv(c.env);
    const created = await db.createDoc<Product>(collections.products, undefined, product);
    return c.json({ product: created }, 201);
  } catch (err) {
    if (err instanceof BadRequestError) return httpError(c, 400, err.message);
    throw err;
  }
});

productRoutes.get("/", async (c) => {
  // Short-TTL cache on the public feed (disabled in tests where `caches`
  // doesn't exist). Keyed by the full URL so filters/search stay distinct.
  const cached = await cacheGet<{ products: Array<Product & { id: string }>; page: number; pageSize: number; hasMore: boolean }>(c.req.url);
  if (cached) return c.json(cached);

  const q = c.req.query();
  const category = q.category;
  const currency = q.currency;
  const bidding = q.isBiddingEnabled;
  const page = Math.max(1, Number.parseInt(q.page ?? "1", 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(q.pageSize ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
  );

  if (category && !(CATEGORIES as readonly string[]).includes(category)) {
    return httpError(c, 400, `Unknown category: ${category}`);
  }
  if (currency && currency !== "USD" && currency !== "RWF") {
    return httpError(c, 400, "currency must be USD or RWF");
  }
  if (bidding && bidding !== "true" && bidding !== "false") {
    return httpError(c, 400, "isBiddingEnabled must be true or false");
  }

  let sortBy: SortBy | null;
  let priceMin: number | null;
  let priceMax: number | null;
  try {
    sortBy = asSortBy(q.sortBy);
    priceMin = asPriceBound(q.priceMin);
    priceMax = asPriceBound(q.priceMax);
  } catch (err) {
    if (err instanceof BadRequestError) return httpError(c, 400, err.message);
    throw err;
  }
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
    return httpError(c, 400, "priceMin cannot be greater than priceMax");
  }

  const filters: QueryFilter[] = [{ field: "status", op: "==", value: "active" }];
  if (category) filters.push({ field: "category", op: "==", value: category });
  if (currency) filters.push({ field: "priceCurrency", op: "==", value: currency });
  if (bidding) filters.push({ field: "isBiddingEnabled", op: "==", value: bidding === "true" });
  if (priceMin !== null) filters.push({ field: "priceAmount", op: ">=", value: priceMin });
  if (priceMax !== null) filters.push({ field: "priceAmount", op: "<=", value: priceMax });

  // Keyword search: `array-contains-any` matches any stored title keyword.
  const search = (q.search ?? "").trim();
  const keywords = search ? titleKeywords(search) : [];
  if (keywords.length > 0) {
    filters.push({ field: "titleKeywords", op: "array-contains-any", value: keywords });
  }

  const orderBy =
    sortBy === "price_asc"
      ? { field: "priceAmount", direction: "ASCENDING" as const }
      : sortBy === "price_desc"
        ? { field: "priceAmount", direction: "DESCENDING" as const }
        : { field: "createdAt", direction: "DESCENDING" as const };

  const db = firestoreFromEnv(c.env);
  const products = await db.queryCollection<Product>(collections.products, {
    filters,
    orderBy,
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });

  const refreshed = await Promise.all(
    products.map((product) => refreshExpiredReservation(db, product)),
  );

  const payload = {
    products: refreshed,
    page,
    pageSize,
    hasMore: refreshed.length === pageSize,
  };
  await cachePut(c.req.url, payload, 30);
  return c.json(payload);
});

/** GET /products/mine — the seller's own listings across all statuses. */
productRoutes.get("/mine", authMiddleware, async (c) => {
  const user = c.get("user");
  const db = firestoreFromEnv(c.env);
  const products = await db.queryCollection<Product>(collections.products, {
    filters: [{ field: "sellerId", op: "==", value: user.uid }],
    orderBy: { field: "createdAt", direction: "DESCENDING" },
  });
  const refreshed = await Promise.all(
    products.map((product) => refreshExpiredReservation(db, product)),
  );
  return c.json({ products: refreshed });
});

productRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing product id");

  const cached = await cacheGet<{ product: Product & { id: string }; seller: unknown }>(c.req.url);
  if (cached) return c.json(cached);

  const db = firestoreFromEnv(c.env);
  let product = await db.getDoc<Product>(`${collections.products}/${id}`);
  if (!product || product.status === "removed") {
    return httpError(c, 404, "Product not found");
  }
  product = await refreshExpiredReservation(db, product);

  const seller = await db.getDoc<User>(`${collections.users}/${product.sellerId}`);
  const payload = {
    product,
    seller: seller
      ? {
          uid: seller.uid,
          name: seller.name,
          photoUrl: seller.photoUrl,
          avgRating: seller.avgRating ?? null,
          ratingCount: seller.ratingCount ?? 0,
          verificationStatus: seller.verificationStatus ?? "unverified",
          phoneVerified: Boolean(seller.phoneVerifiedAt),
        }
      : {
          uid: product.sellerId,
          name: "Unknown",
          photoUrl: null,
          avgRating: null,
          ratingCount: 0,
          verificationStatus: "unverified",
          phoneVerified: false,
        },
  };
  await cachePut(c.req.url, payload, 30);
  return c.json(payload);
});

/**
 * POST /products/:id/reserve
 * "Buy now" for non-bidding products: holds the item for the caller with a
 * short reservation window so no one else can grab it before payment.
 */
productRoutes.post("/:id/reserve", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing product id");

  const db = firestoreFromEnv(c.env);
  let product = await db.getDoc<Product>(`${collections.products}/${id}`);
  if (!product || product.status === "removed") {
    return httpError(c, 404, "Product not found");
  }
  product = await refreshExpiredReservation(db, product);

  if (product.isBiddingEnabled) {
    return httpError(c, 400, "This product is listed for bidding, not direct buy");
  }
  if (product.sellerId === user.uid) {
    return httpError(c, 400, "You cannot buy your own product");
  }
  if (product.status !== "active") {
    // Idempotent: already reserved for this buyer.
    if (product.status === "reserved" && product.reservedBy === user.uid) {
      return c.json({
        product,
        checkout: {
          productId: product.id,
          buyerId: user.uid,
          amount: product.priceAmount,
          currency: product.priceCurrency,
        },
      });
    }
    return httpError(c, 409, "This product is no longer available");
  }

  const now = Date.now();
  const updated = await db.updateDoc<Product>(`${collections.products}/${id}`, {
    status: "reserved",
    reservedBy: user.uid,
    reservedUntil: new Date(now + RESERVATION_HOLD_MS).toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return c.json({
    product: updated,
    checkout: {
      productId: updated.id,
      buyerId: user.uid,
      amount: updated.priceAmount,
      currency: updated.priceCurrency,
    },
  });
});

productRoutes.patch("/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing product id");

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return httpError(c, 400, "Invalid JSON body");
  }

  const db = firestoreFromEnv(c.env);
  let existing = await db.getDoc<Product>(`${collections.products}/${id}`);
  if (!existing || existing.status === "removed") {
    return httpError(c, 404, "Product not found");
  }
  existing = await refreshExpiredReservation(db, existing);
  if (existing.sellerId !== user.uid) {
    return httpError(c, 403, "You are not the seller of this product");
  }

  const updates: Partial<Product> = {};
  try {
    if (body.title !== undefined) {
      updates.title = asString(body.title, "title", MAX_TITLE);
      updates.titleKeywords = titleKeywords(updates.title);
    }
    if (body.description !== undefined) {
      updates.description = asString(body.description, "description", MAX_DESCRIPTION);
    }
    if (body.category !== undefined) updates.category = asCategory(body.category);
    if (body.priceAmount !== undefined) {
      updates.priceAmount = asNumber(body.priceAmount, "priceAmount", 0.01, MAX_PRICE);
    }
    if (body.priceCurrency !== undefined) updates.priceCurrency = asCurrency(body.priceCurrency);
    if (body.isNegotiable !== undefined) {
      updates.isNegotiable = asBoolean(body.isNegotiable, "isNegotiable");
    }
    if (body.isBiddingEnabled !== undefined) {
      updates.isBiddingEnabled = asBoolean(body.isBiddingEnabled, "isBiddingEnabled");
    }
    if (body.conditionNote !== undefined) {
      updates.conditionNote = asString(body.conditionNote, "conditionNote", MAX_CONDITION_NOTE, 0);
    }
    if (body.images !== undefined) updates.images = asImages(body.images);
    if (body.videoUrl !== undefined) updates.videoUrl = asMediaKey(body.videoUrl);
    if (body.deliveryFee !== undefined) {
      updates.deliveryFee = asNumber(body.deliveryFee, "deliveryFee", 0, MAX_PRICE);
    }
    if (body.deliveryFeePayer !== undefined) {
      updates.deliveryFeePayer = asDeliveryFeePayer(body.deliveryFeePayer);
    }
    if (body.status !== undefined) updates.status = asStatus(body.status);
    if (Object.keys(updates).length === 0) {
      return httpError(c, 400, "No valid fields to update");
    }
    updates.updatedAt = new Date().toISOString();
  } catch (err) {
    if (err instanceof BadRequestError) return httpError(c, 400, err.message);
    throw err;
  }

  const updated = await db.updateDoc<Product>(`${collections.products}/${id}`, updates);
  return c.json({ product: updated });
});
