import { Hono } from "hono";

import { activeBidsForProduct, highestActiveBid, refreshExpiredReservation } from "../lib/bids";
import { FirestoreError, firestoreFromEnv } from "../lib/firestore";
import { httpError } from "../lib/http";
import { createNotification } from "../lib/notify";
import { authMiddleware } from "../middleware/auth";
import { collections, type Bid, type Product, type User } from "../models";
import type { AppEnv } from "../types";

export const productBidRoutes = new Hono<AppEnv>();

/**
 * POST /products/:id/bids
 * Creates or updates the caller's active bid on a bidding-enabled product.
 * No minimum above the current highest — offers can be below or above asking.
 */
productBidRoutes.post("/:id/bids", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing product id");

  let body: { amount?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return httpError(c, 400, "Invalid JSON body");
  }

  const db = firestoreFromEnv(c.env);
  let product = await db.getDoc<Product>(`${collections.products}/${id}`);
  if (!product || product.status === "removed") {
    return httpError(c, 404, "Product not found");
  }
  product = await refreshExpiredReservation(db, product);

  if (!product.isBiddingEnabled) {
    return httpError(c, 400, "Bidding is not enabled on this product");
  }
  if (product.status !== "active") {
    return httpError(c, 409, "This product is no longer accepting bids");
  }
  if (product.sellerId === user.uid) {
    return httpError(c, 400, "You cannot bid on your own product");
  }
  if (
    typeof body.amount !== "number" ||
    !Number.isFinite(body.amount) ||
    body.amount <= 0
  ) {
    return httpError(c, 400, "amount must be a positive number");
  }
  // Bids are always denominated in the product's price currency; the buyer
  // never supplies a currency.

  const existing = await db.queryCollection<Bid>(collections.bids, {
    filters: [
      { field: "productId", op: "==", value: product.id },
      { field: "buyerId", op: "==", value: user.uid },
      { field: "status", op: "==", value: "active" },
    ],
    limit: 1,
  });

  const now = new Date().toISOString();
  if (existing[0]) {
    const updated = await db.updateDoc<Bid>(`${collections.bids}/${existing[0].id}`, {
      amount: body.amount,
      currency: product.priceCurrency,
      updatedAt: now,
    });
    await createNotification(
      c.env,
      product.sellerId,
      "bid_placed",
      "Offer updated on your listing",
      `${user.name ?? "A buyer"} raised their offer to ${body.amount} ${product.priceCurrency} on "${product.title}".`,
      { productId: product.id },
    );
    return c.json({ bid: updated }, 200);
  }

  // Bids use a deterministic document id keyed by (product, buyer) so two
  // concurrent first-bids can never both create an "active" row — the second
  // create hits the existing id and falls into the revive path below.
  const bidKey = `${product.id}__${user.uid}`;
  const bidPath = `${collections.bids}/${bidKey}`;
  const bidDoc: Bid = {
    productId: product.id,
    buyerId: user.uid,
    amount: body.amount,
    currency: product.priceCurrency,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  let created: Bid & { id: string };
  try {
    created = await db.createDoc<Bid>(collections.bids, bidKey, bidDoc);
  } catch (err) {
    if (!(err instanceof FirestoreError) || err.status !== 409) throw err;
    // A bid row already exists for this product+buyer (withdrawn earlier, or a
    // concurrent first-bid won the create). Reactivate it with the new amount.
    const revived = await db.updateDoc<Bid>(bidPath, {
      amount: body.amount,
      currency: product.priceCurrency,
      status: "active",
      updatedAt: now,
    });
    created = revived;
  }
  await createNotification(
    c.env,
    product.sellerId,
    "bid_placed",
    "New offer on your listing",
    `${user.name ?? "A buyer"} offered ${body.amount} ${product.priceCurrency} on "${product.title}".`,
    { productId: product.id },
  );
  return c.json({ bid: created }, 201);
});

/** GET /products/:id/bids — public bid summary (bidders stay anonymous). */
productBidRoutes.get("/:id/bids", async (c) => {
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing product id");

  const db = firestoreFromEnv(c.env);
  let product = await db.getDoc<Product>(`${collections.products}/${id}`);
  if (!product || product.status === "removed") {
    return httpError(c, 404, "Product not found");
  }
  product = await refreshExpiredReservation(db, product);

  const bids = await activeBidsForProduct(db, product.id);
  return c.json({
    bidCount: bids.length,
    highestBid: product.isBiddingEnabled ? highestActiveBid(bids) : null,
    currency: product.priceCurrency,
  });
});

/** GET /products/:id/bids/mine — the caller's own active bid on this product. */
productBidRoutes.get("/:id/bids/mine", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing product id");

  const db = firestoreFromEnv(c.env);
  const product = await db.getDoc<Product>(`${collections.products}/${id}`);
  if (!product || product.status === "removed") {
    return httpError(c, 404, "Product not found");
  }

  const mine = await db.queryCollection<Bid>(collections.bids, {
    filters: [
      { field: "productId", op: "==", value: product.id },
      { field: "buyerId", op: "==", value: user.uid },
      { field: "status", op: "==", value: "active" },
    ],
    limit: 1,
  });
  return c.json({ bid: mine[0] ?? null });
});

/** GET /products/:id/bids/all — seller-only, active bids + bidder info, highest first. */
productBidRoutes.get("/:id/bids/all", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing product id");

  const db = firestoreFromEnv(c.env);
  const product = await db.getDoc<Product>(`${collections.products}/${id}`);
  if (!product || product.status === "removed") {
    return httpError(c, 404, "Product not found");
  }
  if (product.sellerId !== user.uid) {
    return httpError(c, 403, "Only the seller can view bids");
  }

  const bids = await db.queryCollection<Bid>(collections.bids, {
    filters: [
      { field: "productId", op: "==", value: product.id },
      { field: "status", op: "==", value: "active" },
    ],
    orderBy: { field: "amount", direction: "DESCENDING" },
  });

  // Batch-fetch all bidders in one round-trip instead of one getDoc per bid.
  const buyers = await db.getManyDocs<User>(
    bids.map((bid) => `${collections.users}/${bid.buyerId}`),
  );

  const rows = bids.map((bid) => {
    const buyer = buyers.get(bid.buyerId);
    return {
      id: bid.id,
      amount: bid.amount,
      currency: bid.currency,
      createdAt: bid.createdAt,
      buyer: buyer
        ? {
            uid: buyer.uid,
            name: buyer.name,
            photoUrl: buyer.photoUrl,
            avgRating: buyer.avgRating ?? null,
            ratingCount: buyer.ratingCount ?? 0,
          }
        : { uid: bid.buyerId, name: "Unknown", photoUrl: null, avgRating: null, ratingCount: 0 },
    };
  });

  return c.json({ bids: rows });
});
