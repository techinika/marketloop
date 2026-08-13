import { Hono } from "hono";

import { RESERVATION_HOLD_MS, refreshExpiredReservation } from "../lib/bids";
import { firestoreFromEnv, type QueryFilter } from "../lib/firestore";
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

class BadRequestError extends Error {}

function asString(
  value: unknown,
  label: string,
  max: number,
  min = 1,
): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new BadRequestError(`${label} must be a string of ${min}-${max} characters`);
  }
  return value;
}

function asBoolean(value: unknown, label: string, fallback?: boolean): boolean {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "boolean") throw new BadRequestError(`${label} must be a boolean`);
  return value;
}

function asNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new BadRequestError(`${label} must be a number between ${min} and ${max}`);
  }
  return value;
}

function asCategory(value: unknown): string {
  const category = asString(value, "category", 50);
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    throw new BadRequestError(`category is not supported: ${category}`);
  }
  return category;
}

function asCurrency(value: unknown): Currency {
  if (value !== "USD" && value !== "RWF") {
    throw new BadRequestError("priceCurrency must be USD or RWF");
  }
  return value;
}

function asDeliveryFeePayer(value: unknown): DeliveryFeePayer {
  if (value !== "seller" && value !== "buyer") {
    throw new BadRequestError("deliveryFeePayer must be seller or buyer");
  }
  return value;
}

function asStatus(value: unknown): ProductStatus {
  if (value !== "active" && value !== "sold" && value !== "reserved" && value !== "removed") {
    throw new BadRequestError("status must be active, sold, reserved or removed");
  }
  return value;
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
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  try {
    const now = new Date().toISOString();
    const product: Product = {
      sellerId: user.uid,
      title: asString(body.title, "title", MAX_TITLE),
      description: asString(body.description, "description", MAX_DESCRIPTION),
      category: asCategory(body.category),
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
    if (err instanceof BadRequestError) return c.json({ error: err.message }, 400);
    throw err;
  }
});

productRoutes.get("/", async (c) => {
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
    return c.json({ error: `Unknown category: ${category}` }, 400);
  }
  if (currency && currency !== "USD" && currency !== "RWF") {
    return c.json({ error: "currency must be USD or RWF" }, 400);
  }
  if (bidding && bidding !== "true" && bidding !== "false") {
    return c.json({ error: "isBiddingEnabled must be true or false" }, 400);
  }

  const filters: QueryFilter[] = [{ field: "status", op: "==", value: "active" }];
  if (category) filters.push({ field: "category", op: "==", value: category });
  if (currency) filters.push({ field: "priceCurrency", op: "==", value: currency });
  if (bidding) filters.push({ field: "isBiddingEnabled", op: "==", value: bidding === "true" });

  const db = firestoreFromEnv(c.env);
  const products = await db.queryCollection<Product>(collections.products, {
    filters,
    orderBy: { field: "createdAt", direction: "DESCENDING" },
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });

  const refreshed = await Promise.all(
    products.map((product) => refreshExpiredReservation(db, product)),
  );

  return c.json({ products: refreshed, page, pageSize, hasMore: refreshed.length === pageSize });
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
  if (!id) return c.json({ error: "Missing product id" }, 400);

  const db = firestoreFromEnv(c.env);
  let product = await db.getDoc<Product>(`${collections.products}/${id}`);
  if (!product || product.status === "removed") {
    return c.json({ error: "Product not found" }, 404);
  }
  product = await refreshExpiredReservation(db, product);

  const seller = await db.getDoc<User>(`${collections.users}/${product.sellerId}`);
  return c.json({
    product,
    seller: seller
      ? { uid: seller.uid, name: seller.name, photoUrl: seller.photoUrl }
      : { uid: product.sellerId, name: "Unknown", photoUrl: null },
  });
});

/**
 * POST /products/:id/reserve
 * "Buy now" for non-bidding products: holds the item for the caller with a
 * short reservation window so no one else can grab it before payment.
 */
productRoutes.post("/:id/reserve", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing product id" }, 400);

  const db = firestoreFromEnv(c.env);
  let product = await db.getDoc<Product>(`${collections.products}/${id}`);
  if (!product || product.status === "removed") {
    return c.json({ error: "Product not found" }, 404);
  }
  product = await refreshExpiredReservation(db, product);

  if (product.isBiddingEnabled) {
    return c.json({ error: "This product is listed for bidding, not direct buy" }, 400);
  }
  if (product.sellerId === user.uid) {
    return c.json({ error: "You cannot buy your own product" }, 400);
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
    return c.json({ error: "This product is no longer available" }, 409);
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
  if (!id) return c.json({ error: "Missing product id" }, 400);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const db = firestoreFromEnv(c.env);
  let existing = await db.getDoc<Product>(`${collections.products}/${id}`);
  if (!existing || existing.status === "removed") {
    return c.json({ error: "Product not found" }, 404);
  }
  existing = await refreshExpiredReservation(db, existing);
  if (existing.sellerId !== user.uid) {
    return c.json({ error: "You are not the seller of this product" }, 403);
  }

  const updates: Partial<Product> = {};
  try {
    if (body.title !== undefined) updates.title = asString(body.title, "title", MAX_TITLE);
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
      return c.json({ error: "No valid fields to update" }, 400);
    }
    updates.updatedAt = new Date().toISOString();
  } catch (err) {
    if (err instanceof BadRequestError) return c.json({ error: err.message }, 400);
    throw err;
  }

  const updated = await db.updateDoc<Product>(`${collections.products}/${id}`, updates);
  return c.json({ product: updated });
});
