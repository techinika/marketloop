import { Hono } from "hono";
import type { Context } from "hono";

import { refreshExpiredReservation } from "../lib/bids";
import { releaseToSeller } from "../lib/escrow";
import { firestoreFromEnv } from "../lib/firestore";
import { httpError } from "../lib/http";
import {
  applyUserRating,
  isMessageTextValid,
  listMessages,
  markOrderMessagesRead,
  sendMessage,
} from "../lib/messages";
import { createNotification } from "../lib/notify";
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
const MESSAGE_TEXT_MAX = 2000;

/** Resolves the caller's role on an order, or null if they're not a party. */
function callerRole(order: Order, uid: string): "buyer" | "seller" | null {
  if (order.buyerId === uid) return "buyer";
  if (order.sellerId === uid) return "seller";
  return null;
}

/** Seller/buyer public summary used in order responses. */
interface PartySummary {
  uid: string;
  name: string;
  photoUrl: string | null;
  /** Average rating + count, included only when the user has been rated. */
  avgRating: number | null;
  ratingCount: number;
}

function partySummary(user: User | null, fallbackUid: string): PartySummary {
  return user
    ? {
        uid: user.uid,
        name: user.name,
        photoUrl: user.photoUrl,
        avgRating: user.avgRating ?? null,
        ratingCount: user.ratingCount ?? 0,
      }
    : { uid: fallbackUid, name: "Unknown", photoUrl: null, avgRating: null, ratingCount: 0 };
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
    return httpError(c, 400, "Invalid JSON body");
  }
  const productId = typeof body.productId === "string" ? body.productId : null;
  if (!productId) return httpError(c, 400, "productId is required");

  const db = firestoreFromEnv(c.env);
  const now = new Date().toISOString();

  // The buyer must hold the active reservation on this product.
  let product = await db.getDoc<Product>(`${collections.products}/${productId}`);
  if (!product || product.status === "removed") {
    return httpError(c, 404, "Product not found");
  }
  product = await refreshExpiredReservation(db, product);
  if (product.status !== "reserved") {
    return httpError(c, 409, "This item is not reserved");
  }
  if (product.reservedBy !== user.uid) {
    return httpError(c, 403, "Only the buyer with the active reservation can pay");
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
      return httpError(c, 409, "Accepted offer not found for this reservation");
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
      return httpError(c, 400, "A valid phone number is required for mobile money");
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

  const products = await db.getManyDocs<Product>(
    [...new Set(orders.map((order) => order.productId))].map((id) => `${collections.products}/${id}`),
  );

  const rows = orders.map((order) => ({
    ...order,
    product: productSummary(products.get(order.productId) ?? null, order.productId),
  }));

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

  const [products, buyers] = await Promise.all([
    db.getManyDocs<Product>(
      [...new Set(orders.map((order) => order.productId))].map((id) => `${collections.products}/${id}`),
    ),
    db.getManyDocs<User>(
      [...new Set(orders.map((order) => order.buyerId))].map((id) => `${collections.users}/${id}`),
    ),
  ]);

  const rows = orders.map((order) => {
    const buyer = buyers.get(order.buyerId) ?? null;
    return {
      ...order,
      product: productSummary(products.get(order.productId) ?? null, order.productId),
      buyer: buyer
        ? {
            uid: buyer.uid,
            name: buyer.name,
            email: buyer.email,
            avgRating: buyer.avgRating ?? null,
            ratingCount: buyer.ratingCount ?? 0,
          }
        : {
            uid: order.buyerId,
            name: "Unknown",
            email: null,
            avgRating: null,
            ratingCount: 0,
          },
    };
  });

  return c.json({ orders: rows });
});

/** GET /orders/:id — buyer or seller only; used for polling after redirect-based payments. */
orderRoutes.get("/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing order id");

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return httpError(c, 404, "Order not found");
  if (order.buyerId !== user.uid && order.sellerId !== user.uid) {
    return httpError(c, 403, "Only the buyer or seller can view this order");
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
 * POST /orders/:id/messages — the caller (buyer or seller on this order)
 * sends a message in the order thread. The other party is notified.
 */
orderRoutes.post("/:id/messages", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing order id");

  let body: { text?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return httpError(c, 400, "Invalid JSON body");
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < 1 || text.length > MESSAGE_TEXT_MAX) {
    return httpError(c, 400, `text must be 1-${MESSAGE_TEXT_MAX} characters`);
  }

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return httpError(c, 404, "Order not found");

  const role = callerRole(order, user.uid);
  if (!role) {
    return httpError(c, 403, "Only the buyer or seller can message on this order");
  }

  const message = await sendMessage(c.env, order.id, user.uid, role, text);

  const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
  const title = product?.title ?? "your order";
  const recipientId = role === "buyer" ? order.sellerId : order.buyerId;
  await createNotification(
    c.env,
    recipientId,
    "order_message",
    "New message on your order",
    `New message from the ${role === "buyer" ? "buyer" : "seller"} on your order for "${title}".`,
    { orderId: order.id, productId: order.productId },
  );

  return c.json({ message }, 201);
});

/**
 * GET /orders/:id/messages — the order thread, oldest first, paginated.
 * Use `before` (a createdAt ISO string) to page further back into history.
 */
orderRoutes.get("/:id/messages", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing order id");

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return httpError(c, 404, "Order not found");
  if (!callerRole(order, user.uid)) {
    return httpError(c, 403, "Only the buyer or seller can view this thread");
  }

  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? "50")));
  const before = c.req.query("before") ?? undefined;
  const result = await listMessages(c.env, order.id, { limit, before });
  return c.json(result);
});

/**
 * POST /orders/:id/messages/read — marks every message from the other party
 * as read for the caller.
 */
orderRoutes.post("/:id/messages/read", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing order id");

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return httpError(c, 404, "Order not found");
  if (!callerRole(order, user.uid)) {
    return httpError(c, 403, "Only the buyer or seller can mark this thread read");
  }

  const updated = await markOrderMessagesRead(c.env, order.id, user.uid);
  return c.json({ updated });
});

/**
 * GET /orders/:id/can-confirm — convenience endpoint for the delivery
 * confirmation UI: whether the caller may confirm, what each side has done,
 * and whether the order is blocked (dispute / not held / already confirmed).
 */
orderRoutes.get("/:id/can-confirm", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing order id");

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return httpError(c, 404, "Order not found");

  const role = callerRole(order, user.uid);
  if (!role) {
    return httpError(c, 403, "Only the buyer or seller can check confirmation status");
  }

  const feedbackSubmitted =
    role === "buyer" ? order.buyerFeedback != null : order.sellerFeedback != null;
  const callerConfirmed =
    role === "buyer" ? order.buyerConfirmedDelivery : order.sellerConfirmedDelivery;
  const otherConfirmed =
    role === "buyer" ? order.sellerConfirmedDelivery : order.buyerConfirmedDelivery;

  let allowed = true;
  let reason: string | null = null;
  if (order.escrowStatus !== "held") {
    allowed = false;
    reason = order.escrowStatus === "pending_payment"
      ? "Payment is not held in escrow yet"
      : "This order can no longer be confirmed";
  } else if (order.hasDispute === true) {
    allowed = false;
    reason = "This order is under review by our support team";
  } else if (feedbackSubmitted || callerConfirmed) {
    allowed = false;
    reason = "You've already submitted your confirmation and feedback";
  }

  return c.json({
    orderId: order.id,
    callerRole: role,
    allowed,
    reason,
    callerConfirmed,
    otherConfirmed,
    callerFeedbackSubmitted: feedbackSubmitted,
    hasDispute: order.hasDispute === true,
    escrowStatus: order.escrowStatus,
  });
});

/**
 * POST /orders/:id/confirm-delivery — upgraded (Prompt 8): each party must
 * confirm delivery AND rate the other party before the second confirmation
 * can release escrow. `received: false` from either side flags the order as a
 * dispute instead of confirming — funds stay locked until an admin resolves it.
 */
orderRoutes.post("/:id/confirm-delivery", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing order id");

  let body: { received?: unknown; rating?: unknown; comment?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return httpError(c, 400, "Invalid JSON body");
  }
  const received = body.received === true;
  const rating =
    typeof body.rating === "number" && Number.isInteger(body.rating)
      ? body.rating
      : typeof body.rating === "string"
        ? Number.parseInt(body.rating, 10)
        : NaN;
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";

  if (typeof body.received !== "boolean") {
    return httpError(c, 400, "received must be a boolean");
  }
  if (!received) {
    // Dispute path: explanation required, no rating needed.
    if (comment.length < 1 || comment.length > 2000) {
      return httpError(c, 400, "comment is required when received is false (explain the issue)");
    }
  } else if (Number.isNaN(rating) || rating < 1 || rating > 5) {
    return httpError(c, 400, "rating must be an integer between 1 and 5");
  }

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return httpError(c, 404, "Order not found");

  const role = callerRole(order, user.uid);
  if (!role) {
    return httpError(c, 403, "Only the buyer or seller can confirm delivery");
  }
  if (order.escrowStatus !== "held") {
    return httpError(c, 409, "Payment is not held in escrow yet");
  }
  if (order.hasDispute === true) {
    return httpError(c, 409, "This order is under review; support will contact you");
  }

  const now = new Date().toISOString();
  const isBuyer = role === "buyer";

  // Dispute: flag for admin, do NOT confirm or touch funds.
  if (!received) {
    const disputed = await db.updateDoc<Order>(`${collections.orders}/${id}`, {
      hasDispute: true,
      disputeReason: comment,
      updatedAt: now,
    });
    await createNotification(
      c.env,
      isBuyer ? order.sellerId : order.buyerId,
      "order_dispute",
      "Your order is under review",
      `The ${isBuyer ? "buyer" : "seller"} reported an issue with this order. Funds stay in escrow while support reviews it.`,
      { orderId: order.id, productId: order.productId },
    );
    await createNotification(
      c.env,
      user.uid,
      "order_dispute",
      "Issue reported — under review",
      "Your report was received. Our support team will review the order and contact you. No funds move until then.",
      { orderId: order.id, productId: order.productId },
    );
    return c.json({ order: disputed, disputed: true });
  }

  // Confirm + feedback path.
  const existingFeedback = isBuyer ? order.buyerFeedback : order.sellerFeedback;
  if (existingFeedback != null) {
    return httpError(c, 409, "You've already submitted feedback for this order");
  }

  const feedback = { rating, comment: comment || null, submittedAt: now };
  const updates: Partial<Order> = {
    updatedAt: now,
  };
  if (isBuyer) {
    updates.buyerConfirmedDelivery = true;
    updates.buyerFeedback = feedback;
  } else {
    updates.sellerConfirmedDelivery = true;
    updates.sellerFeedback = feedback;
  }

  let updated = await db.updateDoc<Order>(`${collections.orders}/${id}`, updates);

  const buyerConfirmed = isBuyer || updated.buyerConfirmedDelivery;
  const sellerConfirmed = !isBuyer || updated.sellerConfirmedDelivery;
  const bothConfirmed =
    buyerConfirmed && sellerConfirmed && updated.buyerFeedback != null && updated.sellerFeedback != null;

  if (bothConfirmed) {
    await releaseToSeller(c.env, updated);
    updated = await db.updateDoc<Order>(`${collections.orders}/${id}`, {
      escrowStatus: "released",
      updatedAt: now,
    });
  }

  // Rating is about the counterpart: buyer rates the seller, seller rates the buyer.
  await applyUserRating(c.env, isBuyer ? order.sellerId : order.buyerId, rating);

  return c.json({ order: updated });
});
