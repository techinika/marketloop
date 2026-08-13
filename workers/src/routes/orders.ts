import { Hono } from "hono";
import type { Context } from "hono";

import { refreshExpiredReservation } from "../lib/bids";
import { releaseToSeller } from "../lib/escrow";
import { firestoreFromEnv } from "../lib/firestore";
import { paypackFromEnv } from "../lib/paypack";
import { pesapalFromEnv } from "../lib/pesapal";
import { authMiddleware } from "../middleware/auth";
import {
  collections,
  type Bid,
  type Order,
  type Product,
  type User,
} from "../models";
import type { AppEnv } from "../types";

export const orderRoutes = new Hono<AppEnv>();

const PHONE_RE = /^\+?\d{9,15}$/;

/** Seller/buyer public summary used in order responses. */
interface PartySummary {
  uid: string;
  name: string;
  photoUrl: string | null;
}

function partySummary(user: User | null, fallbackUid: string): PartySummary {
  return user
    ? { uid: user.uid, name: user.name, photoUrl: user.photoUrl }
    : { uid: fallbackUid, name: "Unknown", photoUrl: null };
}

function productSummary(product: (Product & { id: string }) | null, productId: string) {
  return product
    ? {
        id: product.id,
        title: product.title,
        images: product.images,
        status: product.status,
        priceCurrency: product.priceCurrency,
        isBiddingEnabled: product.isBiddingEnabled,
      }
    : null;
}

/**
 * Lazily returns a Pesapal IPN notification id: the PESAPAL_IPN_ID env override
 * wins; otherwise the id is registered once and cached in Firestore
 * (`platform/pesapal-ipn`) so it isn't re-registered on every order.
 */
async function ensurePesapalIpnId(c: Context<AppEnv>): Promise<string> {
  if (c.env.PESAPAL_IPN_ID) return c.env.PESAPAL_IPN_ID;
  const db = firestoreFromEnv(c.env);
  const cached = await db.getDoc<{ notificationId: string }>(`${collections.platform}/pesapal-ipn`);
  if (cached?.notificationId) return cached.notificationId;

  const pesapal = pesapalFromEnv(c.env);
  const ipnUrl = `${c.env.FRONTEND_URL ?? "http://localhost:3000"}/webhooks/pesapal-ipn`;
  const notificationId = await pesapal.registerIPN(ipnUrl);
  await db.createDoc<{ notificationId: string; url: string; createdAt: string }>(
    collections.platform,
    "pesapal-ipn",
    { notificationId, url: ipnUrl, createdAt: new Date().toISOString() },
  );
  return notificationId;
}

/**
 * POST /orders — buyer with the active reservation on a product starts payment.
 * RWF: Paypack cashin (returns immediately; webhook confirms).
 * USD: Pesapal hosted page (returns redirect_url).
 */
orderRoutes.post("/", authMiddleware, async (c) => {
  const user = c.get("user");

  let body: { productId?: unknown; phoneNumber?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const productId = typeof body.productId === "string" ? body.productId : null;
  if (!productId) return c.json({ error: "productId is required" }, 400);

  const db = firestoreFromEnv(c.env);
  const now = new Date().toISOString();

  // The buyer must hold the active reservation on this product.
  let product = await db.getDoc<Product>(`${collections.products}/${productId}`);
  if (!product || product.status === "removed") {
    return c.json({ error: "Product not found" }, 404);
  }
  product = await refreshExpiredReservation(db, product);
  if (product.status !== "reserved") {
    return c.json({ error: "This item is not reserved" }, 409);
  }
  if (product.reservedBy !== user.uid) {
    return c.json({ error: "Only the buyer with the active reservation can pay" }, 403);
  }

  // Agreed amount: accepted bid for bidding products, else the list price.
  let agreedAmount = product.priceAmount;
  if (product.isBiddingEnabled) {
    const accepted = await db.queryCollection<Bid>(collections.bids, {
      filters: [
        { field: "productId", op: "==", value: product.id },
        { field: "buyerId", op: "==", value: user.uid },
        { field: "status", op: "==", value: "accepted" },
      ],
      limit: 1,
    });
    if (!accepted[0]) {
      return c.json({ error: "Accepted offer not found for this reservation" }, 409);
    }
    agreedAmount = accepted[0].amount;
  }

  const deliveryFee = product.deliveryFee;
  const totalPaid = agreedAmount + deliveryFee;
  const currency = product.priceCurrency;

  // Dedupe: reuse an existing pending_payment order (retry / double-click safe).
  const pending = await db.queryCollection<Order>(collections.orders, {
    filters: [
      { field: "productId", op: "==", value: product.id },
      { field: "buyerId", op: "==", value: user.uid },
      { field: "escrowStatus", op: "==", value: "pending_payment" },
    ],
    limit: 1,
  });
  if (pending[0]) return c.json({ order: pending[0] });

  // Reuse a failed order so the same idempotency key stays valid across retries.
  const failed = await db.queryCollection<Order>(collections.orders, {
    filters: [
      { field: "productId", op: "==", value: product.id },
      { field: "buyerId", op: "==", value: user.uid },
      { field: "escrowStatus", op: "==", value: "failed" },
    ],
    limit: 1,
  });

  const orderFields = {
    productId: product.id,
    sellerId: product.sellerId,
    buyerId: user.uid,
    agreedAmount,
    currency,
    deliveryFee,
    deliveryFeePayer: product.deliveryFeePayer,
    totalPaid,
    paymentProvider: currency === "RWF" ? "paypack" as const : "pesapal" as const,
    paymentReference: "",
    buyerPhoneNumber: null,
    escrowStatus: "pending_payment" as const,
    buyerConfirmedDelivery: false,
    sellerConfirmedDelivery: false,
    deliveryDeadline: "",
    createdAt: now,
    updatedAt: now,
  };

  let order: Order & { id: string };
  if (failed[0]) {
    order = await db.updateDoc<Order>(`${collections.orders}/${failed[0].id}`, orderFields);
  } else {
    order = await db.createDoc<Order>(collections.orders, undefined, orderFields);
  }

  if (currency === "RWF") {
    const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
    if (!PHONE_RE.test(phoneNumber)) {
      return c.json({ error: "A valid phone number is required for mobile money" }, 400);
    }
    try {
      const { ref } = await paypackFromEnv(c.env).cashin(totalPaid, phoneNumber, order.id);
      order = await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
        paymentReference: ref,
        paymentProvider: "paypack",
        buyerPhoneNumber: phoneNumber,
        updatedAt: now,
      });
      return c.json({ order });
    } catch (err) {
      await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
        escrowStatus: "failed",
        updatedAt: now,
      });
      return c.json({
        error: err instanceof Error ? err.message : "Failed to initiate mobile money payment",
      }, 502);
    }
  }

  // USD -> Pesapal hosted payment page.
  try {
    const notificationId = await ensurePesapalIpnId(c);
    const buyer = await db.getDoc<User>(`${collections.users}/${user.uid}`);
    const nameParts = (buyer?.name ?? user.name ?? "").split(" ");
    const { orderTrackingId, redirectUrl } = await pesapalFromEnv(c.env).submitOrder({
      id: order.id,
      amount: totalPaid,
      description: product.title,
      callbackUrl: `${c.env.FRONTEND_URL ?? "http://localhost:3000"}/checkout/callback?orderId=${order.id}`,
      notificationId,
      billingAddress: {
        emailAddress: buyer?.email ?? user.email ?? "",
        phoneNumber: buyer?.phone ?? "",
        countryCode: "RW",
        firstName: nameParts[0] ?? "Buyer",
        lastName: nameParts.slice(1).join(" "),
        line1: "",
        city: "Kigali",
        state: "",
        postalCode: "",
        zipCode: "",
      },
    });
    order = await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
      paymentReference: orderTrackingId,
      paymentProvider: "pesapal",
      updatedAt: now,
    });
    return c.json({ order, redirectUrl });
  } catch (err) {
    await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
      escrowStatus: "failed",
      updatedAt: now,
    });
    return c.json({
      error: err instanceof Error ? err.message : "Failed to start card payment",
    }, 502);
  }
});

/** GET /orders/mine — the caller's purchases (buying side), newest first. */
orderRoutes.get("/mine", authMiddleware, async (c) => {
  const user = c.get("user");
  const db = firestoreFromEnv(c.env);
  const orders = await db.queryCollection<Order>(collections.orders, {
    filters: [{ field: "buyerId", op: "==", value: user.uid }],
    orderBy: { field: "createdAt", direction: "DESCENDING" },
  });

  const rows = await Promise.all(
    orders.map(async (order) => {
      const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
      return { ...order, product: productSummary(product, order.productId) };
    }),
  );

  return c.json({ orders: rows });
});

/** GET /orders/sales — the caller's sales (selling side), newest first. */
orderRoutes.get("/sales", authMiddleware, async (c) => {
  const user = c.get("user");
  const db = firestoreFromEnv(c.env);
  const orders = await db.queryCollection<Order>(collections.orders, {
    filters: [{ field: "sellerId", op: "==", value: user.uid }],
    orderBy: { field: "createdAt", direction: "DESCENDING" },
  });

  const rows = await Promise.all(
    orders.map(async (order) => {
      const [product, buyer] = await Promise.all([
        db.getDoc<Product>(`${collections.products}/${order.productId}`),
        db.getDoc<User>(`${collections.users}/${order.buyerId}`),
      ]);
      return {
        ...order,
        product: productSummary(product, order.productId),
        buyer: buyer
          ? { uid: buyer.uid, name: buyer.name, email: buyer.email }
          : { uid: order.buyerId, name: "Unknown", email: null },
      };
    }),
  );

  return c.json({ orders: rows });
});

/** GET /orders/:id — buyer or seller only; used for polling after redirect-based payments. */
orderRoutes.get("/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing order id" }, 400);

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return c.json({ error: "Order not found" }, 404);
  if (order.buyerId !== user.uid && order.sellerId !== user.uid) {
    return c.json({ error: "Only the buyer or seller can view this order" }, 403);
  }

  const [product, buyer, seller] = await Promise.all([
    db.getDoc<Product>(`${collections.products}/${order.productId}`),
    db.getDoc<User>(`${collections.users}/${order.buyerId}`),
    db.getDoc<User>(`${collections.users}/${order.sellerId}`),
  ]);

  return c.json({
    order,
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
    buyer: partySummary(buyer, order.buyerId),
    seller: partySummary(seller, order.sellerId),
  });
});

/**
 * POST /orders/:id/confirm-delivery — the caller confirms depending on their
 * role in the order. When BOTH parties have confirmed, escrow is released and
 * the seller's platform wallet is credited (see lib/escrow.ts).
 */
orderRoutes.post("/:id/confirm-delivery", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing order id" }, 400);

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return c.json({ error: "Order not found" }, 404);

  const isBuyer = order.buyerId === user.uid;
  const isSeller = order.sellerId === user.uid;
  if (!isBuyer && !isSeller) {
    return c.json({ error: "Only the buyer or seller can confirm delivery" }, 403);
  }
  if (order.escrowStatus !== "held") {
    return c.json({ error: "Payment is not held in escrow yet" }, 409);
  }

  const now = new Date().toISOString();
  const buyerConfirmed = isBuyer ? true : order.buyerConfirmedDelivery;
  const sellerConfirmed = isSeller ? true : order.sellerConfirmedDelivery;

  let updated = await db.updateDoc<Order>(`${collections.orders}/${id}`, {
    buyerConfirmedDelivery: buyerConfirmed,
    sellerConfirmedDelivery: sellerConfirmed,
    updatedAt: now,
  });

  if (buyerConfirmed && sellerConfirmed) {
    await releaseToSeller(c.env, updated);
    updated = await db.updateDoc<Order>(`${collections.orders}/${id}`, {
      escrowStatus: "released",
      updatedAt: now,
    });
  }

  return c.json({ order: updated });
});
