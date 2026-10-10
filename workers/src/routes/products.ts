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
  type CustomizationOption,
  type DeliveryFeePayer,
  type Product,
  type ProductStatus,
  type ProductType,
  type User,
} from "../models";
import type { AppEnv } from "../types";

export const productRoutes = new Hono<AppEnv>();

const MAX_TITLE = 100;
// Descriptions are rich text (HTML), so the cap accounts for markup overhead.
const MAX_DESCRIPTION = 20000;
const MAX_CONDITION_NOTE = 100;
const MAX_MEDIA_KEY = 200;
const MAX_PRICE = 999_999_999;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_PRODUCTION_DAYS = 365;
const MAX_CUSTOMIZATION_OPTIONS = 10;
const MAX_OPTION_LABEL = 120;
const MAX_CHOICE = 120;
const MAX_CHOICES = 30;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 24;
const MAX_MATERIALS = 15;
const MAX_MATERIAL_LENGTH = 40;
const MAX_REGION_LENGTH = 60;
const MAX_QUANTITY = 999_999;
const MAX_CONCURRENT_ORDERS = 1000;
const PRODUCT_TYPES = ["made_to_order", "ready_to_ship"] as const;
/** Multi-unit purchases are capped so a sold-out race never over-commits. */
const MAX_ORDER_QUANTITY = 20;

function asCategory(value: unknown): string {
  return asOneOf(value, "category", CATEGORIES as readonly string[]);
}

function asCurrency(value: unknown): Currency {
  return asOneOf(value, "priceCurrency", ["USD", "RWF"] as const);
}

function asDeliveryFeePayer(value: unknown): DeliveryFeePayer {
  return asOneOf(value, "deliveryFeePayer", ["artisan", "buyer"] as const);
}

function asProductType(value: unknown): ProductType {
  return asOneOf(value, "productType", PRODUCT_TYPES);
}

function asStatus(value: unknown): ProductStatus {
  return asOneOf(value, "status", ["active", "sold", "reserved", "removed", "sold_out"] as const);
}

/** Lowercased, deduped discovery tags (e.g. "sisal", "wedding"). */
function asStrings(value: unknown, label: string, max: number, maxLength: number): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value) && value.length === 0) return [];
  if (!Array.isArray(value) || value.length > max) {
    throw new BadRequestError(`${label} must be an array of up to ${max} items`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== "string") {
      throw new BadRequestError(`${label}[${i}] must be a string`);
    }
    const cleaned = item.trim().toLowerCase().replace(/\s+/g, " ");
    if (cleaned.length < 1 || cleaned.length > maxLength) {
      throw new BadRequestError(`${label}[${i}] must be 1-${maxLength} characters`);
    }
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  return out;
}

function asTags(value: unknown): string[] {
  return asStrings(value, "tags", MAX_TAGS, MAX_TAG_LENGTH);
}

function asMaterials(value: unknown): string[] {
  return asStrings(value, "materials", MAX_MATERIALS, MAX_MATERIAL_LENGTH);
}

function asRegion(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new BadRequestError("region must be a string or null");
  const cleaned = value.trim();
  if (cleaned.length < 1 || cleaned.length > MAX_REGION_LENGTH) {
    throw new BadRequestError(`region must be 1-${MAX_REGION_LENGTH} characters`);
  }
  return cleaned;
}

function asMaxConcurrentOrders(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const parsed = asNumber(value, "maxConcurrentOrders", 1, MAX_CONCURRENT_ORDERS);
  return Number.isInteger(parsed) ? parsed : null;
}

function asQuantityAvailable(value: unknown): number {
  const parsed = asNumber(value, "quantityAvailable", 0, MAX_QUANTITY);
  if (!Number.isInteger(parsed)) {
    throw new BadRequestError("quantityAvailable must be a whole number");
  }
  return parsed;
}

/** Splits a comma-separated query param into deduped, trimmed values (max 10 for array-contains-any). */
function splitQueryList(value: string | undefined, maxTotal: number): string[] {
  if (!value) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(",")) {
    const item = raw.trim().toLowerCase();
    if (item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= Math.min(10, maxTotal)) break;
  }
  return out;
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

/** Validates the artisan's structured customization question list. */
function asCustomizationOptions(value: unknown): CustomizationOption[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CUSTOMIZATION_OPTIONS) {
    throw new BadRequestError(`customizationOptions must be an array of up to ${MAX_CUSTOMIZATION_OPTIONS} options`);
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      throw new BadRequestError(`customizationOptions[${index}] must be an object`);
    }
    const opt = raw as Record<string, unknown>;
    const id = typeof opt.id === "string" ? opt.id.trim() : "";
    if (id.length < 1 || id.length > 64) {
      throw new BadRequestError(`customizationOptions[${index}].id must be 1-64 characters`);
    }
    if (seen.has(id)) throw new BadRequestError(`customizationOptions[${index}].id must be unique`);
    seen.add(id);
    const type = asOneOf(opt.type, `customizationOptions[${index}].type`, [
      "text",
      "choice",
      "image_upload",
    ] as const);
    const label = asString(opt.label, `customizationOptions[${index}].label`, MAX_OPTION_LABEL);
    const required = asBoolean(opt.required, `customizationOptions[${index}].required`, false);
    const priceAdjustment =
      opt.priceAdjustment === undefined
        ? 0
        : asNumber(opt.priceAdjustment, `customizationOptions[${index}].priceAdjustment`, -MAX_PRICE, MAX_PRICE);

    let choices: string[] | undefined;
    if (type === "choice") {
      if (!Array.isArray(opt.choices) || opt.choices.length < 1 || opt.choices.length > MAX_CHOICES) {
        throw new BadRequestError(
          `customizationOptions[${index}].choices must list 1-${MAX_CHOICES} options for type "choice"`,
        );
      }
      choices = opt.choices.map((choice, ci) =>
        asString(choice, `customizationOptions[${index}].choices[${ci}]`, MAX_CHOICE),
      );
    }
    return { id, type, label, required, priceAdjustment, ...(choices ? { choices } : {}) };
  });
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
    const productType = asProductType(body.productType);
    const isBiddingEnabled = asBoolean(body.isBiddingEnabled, "isBiddingEnabled", false);
    if (productType === "ready_to_ship" && isBiddingEnabled) {
      throw new BadRequestError("Ready-to-ship items cannot be listed for bidding");
    }
    const base = {
      artisanId: user.uid,
      title,
      description: asString(body.description, "description", MAX_DESCRIPTION),
      category: asCategory(body.category),
      titleKeywords: titleKeywords(title),
      priceAmount: asNumber(body.priceAmount, "priceAmount", 0.01, MAX_PRICE),
      priceCurrency: asCurrency(body.priceCurrency),
      isNegotiable: asBoolean(body.isNegotiable, "isNegotiable", false),
      isBiddingEnabled,
      conditionNote: asString(body.conditionNote, "conditionNote", MAX_CONDITION_NOTE, 0),
      images: asImages(body.images),
      videoUrl: asMediaKey(body.videoUrl ?? null),
      deliveryFee: asNumber(body.deliveryFee, "deliveryFee", 0, MAX_PRICE),
      deliveryFeePayer: asDeliveryFeePayer(body.deliveryFeePayer),
      productType,
      tags: asTags(body.tags),
      materials: asMaterials(body.materials),
      region: asRegion(body.region),
      status: "active" as const,
      reservedBy: null,
      reservedUntil: null,
      createdAt: now,
      updatedAt: now,
    };

    let product: Product;
    if (productType === "ready_to_ship") {
      product = {
        ...base,
        acceptingOrders: true,
        maxConcurrentOrders: null,
        currentOpenOrders: 0,
        manuallyPaused: false,
        quantityAvailable: asQuantityAvailable(body.quantityAvailable),
        productionTimeDays: 0,
        isCustomizable: asBoolean(body.isCustomizable, "isCustomizable", false),
        customizationOptions: [],
        allowsReferenceUpload: false,
      };
    } else {
      product = {
        ...base,
        acceptingOrders: asBoolean(body.acceptingOrders, "acceptingOrders", true),
        maxConcurrentOrders: asMaxConcurrentOrders(body.maxConcurrentOrders),
        currentOpenOrders: 0,
        manuallyPaused: false,
        quantityAvailable: 0,
        productionTimeDays: asNumber(body.productionTimeDays, "productionTimeDays", 1, MAX_PRODUCTION_DAYS),
        isCustomizable: asBoolean(body.isCustomizable, "isCustomizable", false),
        customizationOptions: asCustomizationOptions(body.customizationOptions),
        allowsReferenceUpload: asBoolean(body.allowsReferenceUpload, "allowsReferenceUpload", true),
      };
    }
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
  const productType = q.productType;
  const region = (q.region ?? "").trim();
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
  if (productType && productType !== "made_to_order" && productType !== "ready_to_ship") {
    return httpError(c, 400, "productType must be made_to_order or ready_to_ship");
  }
  if (region.length > MAX_REGION_LENGTH) {
    return httpError(c, 400, `region must be at most ${MAX_REGION_LENGTH} characters`);
  }
  // `tags` / `materials` are comma-separated; Firestore's array-contains-any caps out at 10.
  const tags = splitQueryList(q.tags, MAX_TAGS);
  const materials = splitQueryList(q.materials, MAX_MATERIALS);

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
  // Either listing kind filters on its own field. (Listings created before
  // productType existed carry no field and only appear under "all".)
  if (productType) {
    filters.push({ field: "productType", op: "==", value: productType });
  }
  if (region) filters.push({ field: "region", op: "==", value: region });
  if (tags.length > 0) {
    filters.push({ field: "tags", op: "array-contains-any", value: tags });
  }
  if (materials.length > 0) {
    filters.push({ field: "materials", op: "array-contains-any", value: materials });
  }

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

/** GET /products/mine — the artisan's own listings across all statuses. */
productRoutes.get("/mine", authMiddleware, async (c) => {
  const user = c.get("user");
  const db = firestoreFromEnv(c.env);
  const products = await db.queryCollection<Product>(collections.products, {
    filters: [{ field: "artisanId", op: "==", value: user.uid }],
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

  const cached = await cacheGet<{ product: Product & { id: string }; artisan: unknown }>(c.req.url);
  if (cached) return c.json(cached);

  const db = firestoreFromEnv(c.env);
  let product = await db.getDoc<Product>(`${collections.products}/${id}`);
  if (!product || product.status === "removed") {
    return httpError(c, 404, "Product not found");
  }
  product = await refreshExpiredReservation(db, product);

  const artisan = await db.getDoc<User>(`${collections.users}/${product.artisanId}`);
  const payload = {
    product,
    artisan: artisan
      ? {
          uid: artisan.uid,
          name: artisan.name,
          photoUrl: artisan.photoUrl,
          avgRating: artisan.avgRating ?? null,
          ratingCount: artisan.ratingCount ?? 0,
          verificationStatus: artisan.verificationStatus ?? "unverified",
          phoneVerified: Boolean(artisan.phoneVerifiedAt),
        }
      : {
          uid: product.artisanId,
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
  if (product.productType === "ready_to_ship") {
    return httpError(c, 409, "Ready-to-ship items are bought directly at checkout without a reservation");
  }
  if (product.artisanId === user.uid) {
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
    reservedAmount: product.priceAmount,
    reservedCurrency: product.priceCurrency,
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
  if (existing.artisanId !== user.uid) {
    return httpError(c, 403, "You are not the artisan of this product");
  }

  const updates: Partial<Product> = {};
  try {
    if (body.productType !== undefined) {
      throw new BadRequestError("productType cannot be changed after creation");
    }
    const isRts = existing.productType === "ready_to_ship";
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
    if (body.tags !== undefined) updates.tags = asTags(body.tags);
    if (body.materials !== undefined) updates.materials = asMaterials(body.materials);
    if (body.region !== undefined) updates.region = asRegion(body.region);
    if (body.isCustomizable !== undefined) {
      updates.isCustomizable = asBoolean(body.isCustomizable, "isCustomizable");
    }

    if (isRts) {
      if (body.quantityAvailable !== undefined) {
        const qty = asQuantityAvailable(body.quantityAvailable);
        updates.quantityAvailable = qty;
        // Restocking a sold-out item makes it buyable again.
        if (qty > 0 && existing.status === "sold_out") {
          updates.status = "active";
          updates.reservedBy = null;
          updates.reservedUntil = null;
        }
      }
      if (
        body.productionTimeDays !== undefined ||
        body.customizationOptions !== undefined ||
        body.allowsReferenceUpload !== undefined ||
        body.acceptingOrders !== undefined ||
        body.maxConcurrentOrders !== undefined
      ) {
        throw new BadRequestError("That field only applies to made-to-order listings");
      }
    } else {
      if (body.quantityAvailable !== undefined) {
        throw new BadRequestError("quantityAvailable only applies to ready-to-ship listings");
      }
      if (body.productionTimeDays !== undefined) {
        updates.productionTimeDays = asNumber(body.productionTimeDays, "productionTimeDays", 1, MAX_PRODUCTION_DAYS);
      }
      if (body.customizationOptions !== undefined) {
        updates.customizationOptions = asCustomizationOptions(body.customizationOptions);
      }
      if (body.allowsReferenceUpload !== undefined) {
        updates.allowsReferenceUpload = asBoolean(body.allowsReferenceUpload, "allowsReferenceUpload");
      }
      if (body.maxConcurrentOrders !== undefined) {
        updates.maxConcurrentOrders = asMaxConcurrentOrders(body.maxConcurrentOrders);
      }
      if (body.acceptingOrders !== undefined) {
        const accepting = asBoolean(body.acceptingOrders, "acceptingOrders");
        const max = updates.maxConcurrentOrders ?? existing.maxConcurrentOrders ?? null;
        const open = existing.currentOpenOrders ?? 0;
        if (accepting && max !== null && open >= max) {
          throw new BadRequestError(
            "This listing is at full capacity; raise maxConcurrentOrders to accept new orders",
          );
        }
        updates.acceptingOrders = accepting;
        updates.manuallyPaused = !accepting;
      }
      // Raising the cap past the open count re-opens orders (unless manually paused).
      if (
        updates.maxConcurrentOrders !== undefined &&
        updates.acceptingOrders === undefined &&
        existing.acceptingOrders === false
      ) {
        const newMax = updates.maxConcurrentOrders;
        if (
          typeof newMax === "number" &&
          (existing.currentOpenOrders ?? 0) < newMax &&
          existing.manuallyPaused !== true
        ) {
          updates.acceptingOrders = true;
        }
      }
    }

    if (body.status !== undefined) {
      const status = asStatus(body.status);
      if (isRts && (status === "reserved" || status === "sold")) {
        throw new BadRequestError(`Ready-to-ship items cannot be set to "${status}"`);
      }
      if (!isRts && status === "sold_out") {
        throw new BadRequestError('"sold_out" only applies to ready-to-ship listings');
      }
      updates.status = status;
    }
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
