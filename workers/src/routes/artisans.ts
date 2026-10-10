import { Hono } from "hono";

import { refreshExpiredReservation } from "../lib/bids";
import { firestoreFromEnv } from "../lib/firestore";
import { httpError } from "../lib/http";
import { BadRequestError, asString } from "../lib/validation";
import { authMiddleware } from "../middleware/auth";
import { collections, type Product, type User } from "../models";
import type { AppEnv } from "../types";

export const artisanRoutes = new Hono<AppEnv>();

const MAX_STORE_NAME = 60;
const MAX_STORE_BIO = 500;
const MAX_REGION = 60;
const MAX_SPECIALTIES = 10;
const MAX_SPECIALTY_LENGTH = 30;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const DEFAULT_ARTISAN_LIMIT = 8;
const MAX_ARTISAN_LIMIT = 24;
/** How many recent users to scan when assembling the featured list. */
const ARTISAN_SCAN_LIMIT = 60;

/** Maps a user document to the public storefront shape. */
function toStorefront(user: User) {
  return {
    uid: user.uid,
    name: user.name,
    photoUrl: user.photoUrl,
    storeName: user.storeName ?? null,
    storeBio: user.storeBio ?? null,
    storeRegion: user.storeRegion ?? null,
    specialties: user.specialties ?? [],
    avgRating: user.avgRating ?? null,
    ratingCount: user.ratingCount ?? 0,
    isVerifiedSeller: user.verificationStatus === "verified",
    joinedAt: user.createdAt,
  };
}

/** A user is treated as a "shop" when they have a storefront profile. */
function isShop(user: User): boolean {
  return (
    (user.storeName ?? "").trim() !== "" ||
    (user.specialties?.length ?? 0) > 0 ||
    user.verificationStatus === "verified"
  );
}

function asStoreText(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  const cleaned = asString(value, label, max, 1);
  return cleaned;
}

function asSpecialties(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value) && value.length === 0) return [];
  if (!Array.isArray(value) || value.length > MAX_SPECIALTIES) {
    throw new BadRequestError(`specialties must be an array of up to ${MAX_SPECIALTIES} items`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== "string") {
      throw new BadRequestError(`specialties[${i}] must be a string`);
    }
    const cleaned = item.trim();
    if (cleaned.length < 1 || cleaned.length > MAX_SPECIALTY_LENGTH) {
      throw new BadRequestError(`specialties[${i}] must be 1-${MAX_SPECIALTY_LENGTH} characters`);
    }
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  return out;
}

/**
 * GET /artisans — a short list of shops for the homepage "featured artisans"
 * section: recent users who have a storefront profile, ranked by reputation
 * (rating count, then average rating). Not paginated; the list is intentionally
 * small and curated by ranking.
 */
artisanRoutes.get("/", async (c) => {
  const requested = Number.parseInt(c.req.query("limit") ?? "", 10);
  const limit = Number.isFinite(requested)
    ? Math.min(MAX_ARTISAN_LIMIT, Math.max(1, requested))
    : DEFAULT_ARTISAN_LIMIT;

  const db = firestoreFromEnv(c.env);
  const users = await db.queryCollection<User>(collections.users, {
    orderBy: { field: "createdAt", direction: "DESCENDING" },
    limit: ARTISAN_SCAN_LIMIT,
  });

  const artisans = users
    .filter(isShop)
    .sort(
      (a, b) =>
        (b.ratingCount ?? 0) - (a.ratingCount ?? 0) ||
        (b.avgRating ?? 0) - (a.avgRating ?? 0),
    )
    .slice(0, limit)
    .map(toStorefront);

  return c.json({ artisans });
});

/**
 * GET /artisans/:uid — public artisan storefront: profile + currently active
 * listings (both made-to-order and ready-to-ship), newest first.
 */
artisanRoutes.get("/:uid", async (c) => {
  const uid = c.req.param("uid");
  if (!uid) return httpError(c, 400, "Missing uid");

  const db = firestoreFromEnv(c.env);
  const user = await db.getDoc<User>(`${collections.users}/${uid}`);
  if (!user) return httpError(c, 404, "Artisan not found");

  const q = c.req.query();
  const page = Math.max(1, Number.parseInt(q.page ?? "1", 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(q.pageSize ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
  );

  const products = await db.queryCollection<Product>(collections.products, {
    filters: [
      { field: "artisanId", op: "==", value: uid },
      { field: "status", op: "==", value: "active" },
    ],
    orderBy: { field: "createdAt", direction: "DESCENDING" },
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });
  const refreshed = await Promise.all(products.map((product) => refreshExpiredReservation(db, product)));

  return c.json({
    artisan: toStorefront(user),
    products: refreshed,
    page,
    pageSize,
    hasMore: refreshed.length === pageSize,
  });
});

/** PATCH /artisans/me — the caller updates their public storefront profile. */
artisanRoutes.patch("/me", authMiddleware, async (c) => {
  const user = c.get("user");

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return httpError(c, 400, "Invalid JSON body");
  }

  const updates: Partial<User> = {};
  try {
    if (body.storeName !== undefined) updates.storeName = asStoreText(body.storeName, "storeName", MAX_STORE_NAME);
    if (body.storeBio !== undefined) updates.storeBio = asStoreText(body.storeBio, "storeBio", MAX_STORE_BIO);
    if (body.storeRegion !== undefined) updates.storeRegion = asStoreText(body.storeRegion, "storeRegion", MAX_REGION);
    if (body.specialties !== undefined) updates.specialties = asSpecialties(body.specialties);
    if (Object.keys(updates).length === 0) {
      return httpError(c, 400, "No valid fields to update");
    }
  } catch (err) {
    if (err instanceof BadRequestError) return httpError(c, 400, err.message);
    throw err;
  }

  const db = firestoreFromEnv(c.env);
  const updated = await db.updateDoc<User>(`${collections.users}/${user.uid}`, {
    ...updates,
    updatedAt: new Date().toISOString(),
  });

  return c.json({
    user: {
      uid: updated.uid,
      name: updated.name,
      photoUrl: updated.photoUrl,
      storeName: updated.storeName ?? null,
      storeBio: updated.storeBio ?? null,
      storeRegion: updated.storeRegion ?? null,
      specialties: updated.specialties ?? [],
    },
  });
});