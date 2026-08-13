import { Hono } from "hono";

import { RESERVATION_HOLD_MS, refreshExpiredReservation } from "../lib/bids";
import { firestoreFromEnv } from "../lib/firestore";
import { createNotification } from "../lib/notify";
import { authMiddleware } from "../middleware/auth";
import { collections, type Bid, type Product } from "../models";
import type { AppEnv, Env } from "../types";

export const bidRoutes = new Hono<AppEnv>();

/** Notifies the winning buyer that their offer was accepted. */
async function notifyWinner(
  env: Env,
  bid: Bid & { id: string },
  product: Product & { id: string },
): Promise<void> {
  await createNotification(
    env,
    bid.buyerId,
    "bid_accepted",
    "Your offer was accepted!",
    `The seller accepted your ${bid.amount} ${bid.currency} offer on "${product.title}". Head to checkout to pay.`,
    { orderId: null, productId: product.id },
  );
}

/** GET /bids/mine — the caller's own bids across products, newest first. */
bidRoutes.get("/mine", authMiddleware, async (c) => {
  const user = c.get("user");
  const db = firestoreFromEnv(c.env);

  const bids = await db.queryCollection<Bid>(collections.bids, {
    filters: [{ field: "buyerId", op: "==", value: user.uid }],
    orderBy: { field: "createdAt", direction: "DESCENDING" },
  });

  const rows = await Promise.all(
    bids.map(async (bid) => {
      const product = await db.getDoc<Product>(`${collections.products}/${bid.productId}`);
      return {
        id: bid.id,
        productId: bid.productId,
        amount: bid.amount,
        currency: bid.currency,
        status: bid.status,
        createdAt: bid.createdAt,
        updatedAt: bid.updatedAt,
        product: product
          ? {
              id: product.id,
              title: product.title,
              images: product.images,
              status: product.status,
              priceCurrency: product.priceCurrency,
              isBiddingEnabled: product.isBiddingEnabled,
            }
          : null,
      };
    }),
  );

  return c.json({ bids: rows });
});

/**
 * POST /bids/:bidId/accept
 * Seller accepts a bid: marks it "accepted", withdraws every other active bid
 * on the product, and reserves the item for the winning buyer. Returns
 * checkout info so the frontend can route the buyer to /checkout/:productId.
 */
bidRoutes.post("/:bidId/accept", authMiddleware, async (c) => {
  const user = c.get("user");
  const bidId = c.req.param("bidId");
  if (!bidId) return c.json({ error: "Missing bid id" }, 400);

  const db = firestoreFromEnv(c.env);
  const bid = await db.getDoc<Bid>(`${collections.bids}/${bidId}`);
  if (!bid) return c.json({ error: "Bid not found" }, 404);

  const product = await db.getDoc<Product>(`${collections.products}/${bid.productId}`);
  if (!product || product.status === "removed") {
    return c.json({ error: "Product not found" }, 404);
  }
  if (product.sellerId !== user.uid) {
    return c.json({ error: "Only the seller can accept bids" }, 403);
  }
  if (bid.status !== "active") {
    return c.json({ error: "This bid is no longer active" }, 409);
  }

  const fresh = await refreshExpiredReservation(db, product);
  if (fresh.status !== "active") {
    // Idempotent re-accept when the product is already reserved for this buyer.
    if (fresh.status === "reserved" && fresh.reservedBy === bid.buyerId) {
      const accepted = await db.updateDoc<Bid>(`${collections.bids}/${bidId}`, {
        status: "accepted",
        updatedAt: new Date().toISOString(),
      });
      await notifyWinner(c.env, accepted, fresh);
      return c.json({
        bid: accepted,
        product: fresh,
        checkout: {
          productId: fresh.id,
          buyerId: bid.buyerId,
          amount: bid.amount,
          currency: bid.currency,
        },
      });
    }
    return c.json({ error: "This product is no longer available" }, 409);
  }

  const now = new Date().toISOString();
  const acceptedBid = await db.updateDoc<Bid>(`${collections.bids}/${bidId}`, {
    status: "accepted",
    updatedAt: now,
  });

  const others = await db.queryCollection<Bid>(collections.bids, {
    filters: [
      { field: "productId", op: "==", value: product.id },
      { field: "status", op: "==", value: "active" },
    ],
  });
  for (const other of others) {
    if (other.id === bidId) continue;
    await db.updateDoc<Bid>(`${collections.bids}/${other.id}`, {
      status: "withdrawn",
      updatedAt: now,
    });
    await createNotification(
      c.env,
      other.buyerId,
      "bid_not_selected",
      "Offer not selected",
      `The seller accepted another offer on "${product.title}", so your offer was withdrawn.`,
      { orderId: null, productId: product.id },
    );
  }

  const updatedProduct = await db.updateDoc<Product>(`${collections.products}/${product.id}`, {
    status: "reserved",
    reservedBy: bid.buyerId,
    reservedUntil: new Date(Date.now() + RESERVATION_HOLD_MS).toISOString(),
    updatedAt: now,
  });

  await notifyWinner(c.env, acceptedBid, updatedProduct);

  return c.json({
    bid: acceptedBid,
    product: updatedProduct,
    checkout: {
      productId: updatedProduct.id,
      buyerId: bid.buyerId,
      amount: bid.amount,
      currency: bid.currency,
    },
  });
});

/** POST /bids/:bidId/withdraw — a buyer withdraws their own active bid. */
bidRoutes.post("/:bidId/withdraw", authMiddleware, async (c) => {
  const user = c.get("user");
  const bidId = c.req.param("bidId");
  if (!bidId) return c.json({ error: "Missing bid id" }, 400);

  const db = firestoreFromEnv(c.env);
  const bid = await db.getDoc<Bid>(`${collections.bids}/${bidId}`);
  if (!bid) return c.json({ error: "Bid not found" }, 404);
  if (bid.buyerId !== user.uid) {
    return c.json({ error: "You can only withdraw your own bid" }, 403);
  }
  if (bid.status !== "active") {
    return c.json({ error: "Only active bids can be withdrawn" }, 409);
  }

  const updated = await db.updateDoc<Bid>(`${collections.bids}/${bidId}`, {
    status: "withdrawn",
    updatedAt: new Date().toISOString(),
  });
  return c.json({ bid: updated });
});
