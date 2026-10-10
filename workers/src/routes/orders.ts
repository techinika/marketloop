import { Hono } from "hono";
import type { Context } from "hono";

import { refreshExpiredReservation } from "../lib/bids";
import { DELIVERY_DEADLINE_MS, heldAmountFor, releaseToArtisan } from "../lib/escrow";
import { firestoreFromEnv } from "../lib/firestore";
import { httpError } from "../lib/http";
import { asNumber, asOneOf, asString, BadRequestError } from "../lib/validation";
import { adjustMadeToOrderSlots } from "../lib/inventory";
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
  type CustomizationResponse,
  type Order,
  type PaymentPlan,
  type Product,
  type User,
  type WalletTransaction,
} from "../models";
import type { AppEnv } from "../types";

export const orderRoutes = new Hono<AppEnv>();

const PHONE_RE = /^\+?\d{9,15}$/;
const MESSAGE_TEXT_MAX = 2000;
const MAX_CUSTOMIZATION_RESPONSES = 30;
const MAX_CUSTOMIZATION_VALUE = 1000;
const MAX_REFERENCE_URL = 500;
const MAX_REQUEST_NOTE = 2000;
const PAYMENT_PLANS = ["deposit", "full"] as const;

/** Rounds to 2 decimals — money math for the deposit/final split. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Validates the buyer's answers against the product's structured customization
 * questions and sums their price adjustments (added to the agreed amount).
 * Throws `BadRequestError` with a human-readable message when an answer is
 * missing, unknown, or not one of the offered choices.
 */
function parseCustomization(
  product: Product,
  raw: unknown,
): { responses: CustomizationResponse[]; additions: number } {
  const list = raw === undefined || raw === null ? [] : raw;
  if (!Array.isArray(list)) {
    throw new BadRequestError("customizationResponses must be an array");
  }
  if (list.length > MAX_CUSTOMIZATION_RESPONSES) {
    throw new BadRequestError(
      `customizationResponses must contain at most ${MAX_CUSTOMIZATION_RESPONSES} answers`,
    );
  }
  const options = product.isCustomizable ? (product.customizationOptions ?? []) : [];
  if (list.length > 0 && options.length === 0) {
    throw new BadRequestError("This piece cannot be customized");
  }
  const byId = new Map(options.map((option) => [option.id, option]));
  const answered = new Set<string>();
  const responses: CustomizationResponse[] = [];
  let additions = 0;

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (typeof item !== "object" || item === null) {
      throw new BadRequestError(`customizationResponses[${i}] must be an object`);
    }
    const { optionId, value: rawValue } = item as { optionId?: unknown; value?: unknown };
    const id = typeof optionId === "string" ? optionId : "";
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    const option = byId.get(id);
    if (!option) {
      throw new BadRequestError(`Unknown customization question: ${id || `entry ${i}`}`);
    }
    if (answered.has(id)) {
      throw new BadRequestError(`Duplicate answer for question "${option.label}"`);
    }
    if (value.length < 1 || value.length > MAX_CUSTOMIZATION_VALUE) {
      throw new BadRequestError(
        `Answer for "${option.label}" must be 1-${MAX_CUSTOMIZATION_VALUE} characters`,
      );
    }
    if (option.type === "choice" && option.choices && !option.choices.includes(value)) {
      throw new BadRequestError(`"${value}" is not one of the choices for "${option.label}"`);
    }
    answered.add(id);
    responses.push({ optionId: id, value });
    additions += option.priceAdjustment ?? 0;
  }

  for (const option of options) {
    if (option.required && !answered.has(option.id)) {
      throw new BadRequestError(`Please answer the required question: "${option.label}"`);
    }
  }
  return { responses, additions: round2(additions) };
}

/** Resolves the caller's role on an order, or null if they're not a party. */
function callerRole(order: Order, uid: string): "buyer" | "artisan" | null {
  if (order.buyerId === uid) return "buyer";
  if (order.artisanId === uid) return "artisan";
  return null;
}

/** Artisan/buyer public summary used in order responses. */
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
        priceAmount: product.priceAmount,
        priceCurrency: product.priceCurrency,
        isBiddingEnabled: product.isBiddingEnabled,
        productType: product.productType ?? "made_to_order",
        quantityAvailable: product.quantityAvailable ?? 0,
        acceptingOrders: product.acceptingOrders ?? true,
        maxConcurrentOrders: product.maxConcurrentOrders ?? null,
        currentOpenOrders: product.currentOpenOrders ?? 0,
        productionTimeDays: product.productionTimeDays ?? 0,
        isCustomizable: product.isCustomizable ?? false,
        customizationOptions: product.customizationOptions ?? [],
        allowsReferenceUpload: product.allowsReferenceUpload,
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
  const secretQuery = c.env.PESAPAL_IPN_SECRET ? `?secret=${encodeURIComponent(c.env.PESAPAL_IPN_SECRET)}` : "";
  const ipnUrl = `${c.env.FRONTEND_URL ?? "http://localhost:3000"}/webhooks/pesapal-ipn${secretQuery}`;
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
 * `paymentPlan` splits the total: "deposit" charges 50% now (the rest when the
 * artisan marks the piece ready), "full" (the default) charges everything now.
 * RWF: Paypack cashin (returns immediately; webhook confirms).
 * USD: Pesapal hosted page (returns redirect_url).
 */
orderRoutes.post("/", authMiddleware, async (c) => {
  const user = c.get("user");

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return httpError(c, 400, "Invalid JSON body");
  }
  const productId = typeof body.productId === "string" ? body.productId : null;
  if (!productId) return httpError(c, 400, "productId is required");

  const db = firestoreFromEnv(c.env);
  const now = new Date().toISOString();

  // Made-to-order items need the active reservation held by this buyer;
  // ready-to-ship items are paid in full straight from the listing (no reserve).
  let product = await db.getDoc<Product>(`${collections.products}/${productId}`);
  if (!product || product.status === "removed") {
    return httpError(c, 404, "Product not found");
  }
  product = await refreshExpiredReservation(db, product);
  const isRts = product.productType === "ready_to_ship";
  if (isRts) {
    if (product.artisanId === user.uid) {
      return httpError(c, 400, "You cannot buy your own product");
    }
    if (product.status !== "active") {
      return httpError(c, 409, "This item is no longer available");
    }
  } else {
    if (product.status !== "reserved") {
      return httpError(c, 409, "This item is not reserved");
    }
    if (product.reservedBy !== user.uid) {
      return httpError(c, 403, "Only the buyer with the active reservation can pay");
    }
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
  const currency = product.priceCurrency;

  // Multi-unit purchases (ready-to-ship only); capped so a sold-out race can't
  // over-commit stock. Made-to-order pieces are always quantity 1.
  const quantityRaw = body.quantity ?? 1;
  const quantity =
    typeof quantityRaw === "number" && Number.isInteger(quantityRaw) && quantityRaw >= 1
      ? quantityRaw
      : NaN;
  if (isRts) {
    if (!Number.isFinite(quantity) || quantity > 20) {
      return httpError(c, 400, "quantity must be a whole number between 1 and 20");
    }
    if (typeof product.quantityAvailable === "number" && product.quantityAvailable < quantity) {
      return httpError(c, 409, `Only ${product.quantityAvailable} left in stock`);
    }
  } else if (quantity !== 1) {
    return httpError(c, 400, "Made-to-order pieces are bought one at a time (quantity must be 1)");
  }

  // Payment plan + customization answers + reference brief. All of it is
  // validated up-front so a bad request never creates an order document.
  let paymentPlan: PaymentPlan;
  let customizationResponses: CustomizationResponse[];
  let referenceImageUrl: string | null;
  let customRequestNote: string | null;
  let agreed = 0;
  let totalPaid = 0;
  let depositAmount = 0;
  let finalAmount = 0;
  try {
    // Ready-to-ship items are always paid in full up front.
    if (isRts) {
      if (body.paymentPlan !== undefined) {
        const requested = asOneOf(body.paymentPlan, "paymentPlan", PAYMENT_PLANS);
        if (requested !== "full") {
          throw new BadRequestError("Ready-to-ship items are paid in full up front");
        }
      }
      paymentPlan = "full";
    } else {
      paymentPlan =
        body.paymentPlan === undefined
          ? "full"
          : asOneOf(body.paymentPlan, "paymentPlan", PAYMENT_PLANS);
    }
    const custom = parseCustomization(product, body.customizationResponses);
    customizationResponses = custom.responses;
    referenceImageUrl =
      body.referenceImageUrl === undefined ||
      body.referenceImageUrl === null ||
      body.referenceImageUrl === ""
        ? null
        : asString(body.referenceImageUrl, "referenceImageUrl", MAX_REFERENCE_URL);
    customRequestNote =
      body.customRequestNote === undefined ||
      body.customRequestNote === null ||
      body.customRequestNote === ""
        ? null
        : asString(body.customRequestNote, "customRequestNote", MAX_REQUEST_NOTE, 0);
    if (isRts && (customizationResponses.length > 0 || referenceImageUrl || customRequestNote)) {
      throw new BadRequestError(
        "Customization options are only available on made-to-order pieces",
      );
    }
    if ((referenceImageUrl || customRequestNote) && product.allowsReferenceUpload === false) {
      throw new BadRequestError("This piece does not accept a reference image or custom request note");
    }
    agreed = round2(agreedAmount + custom.additions);
    if (agreed < 0.01) {
      throw new BadRequestError("The customization choices bring the price below the minimum");
    }
    totalPaid = round2(agreed + deliveryFee);
    // Deposit plan: half now, half when the piece is ready (sums to totalPaid exactly).
    depositAmount = paymentPlan === "deposit" ? round2(totalPaid / 2) : totalPaid;
    finalAmount = round2(totalPaid - depositAmount);
  } catch (err) {
    if (err instanceof BadRequestError) return httpError(c, 400, err.message);
    throw err;
  }

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
    artisanId: product.artisanId,
    buyerId: user.uid,
    productType: isRts ? ("ready_to_ship" as const) : ("made_to_order" as const),
    quantity,
    agreedAmount: agreed,
    currency,
    deliveryFee,
    deliveryFeePayer: product.deliveryFeePayer,
    totalPaid,
    paymentPlan,
    depositAmount,
    finalAmount,
    depositPaid: false,
    finalPaid: false,
    productionStatus: "pending_deposit" as const,
    productionStatusAt: now,
    customizationResponses,
    referenceImageUrl,
    customRequestNote,
    cancellationRequest: null,
    paymentProvider: currency === "RWF" ? "paypack" as const : "pesapal" as const,
    paymentReference: "",
    buyerPhoneNumber: null,
    escrowStatus: "pending_payment" as const,
    buyerConfirmedDelivery: false,
    artisanConfirmedDelivery: false,
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

  // Occupy a made-to-order slot now that an order document exists. A reused
  // failed order already released its slot on failure, so it is counted again.
  if (!isRts) {
    await adjustMadeToOrderSlots(c.env, product.id, 1);
  }

  if (currency === "RWF") {
    const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
    if (!PHONE_RE.test(phoneNumber)) {
      return httpError(c, 400, "A valid phone number is required for mobile money");
    }
    try {
      const { ref } = await paypackFromEnv(c.env).cashin(depositAmount, phoneNumber, order.id);
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
      if (!isRts) {
        await adjustMadeToOrderSlots(c.env, product.id, -1);
      }
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
      amount: depositAmount,
      currency,
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
    if (!isRts) {
      await adjustMadeToOrderSlots(c.env, product.id, -1);
    }
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
    filters: [{ field: "artisanId", op: "==", value: user.uid }],
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

/** GET /orders/:id — buyer or artisan only; used for polling after redirect-based payments. */
orderRoutes.get("/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing order id");

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return httpError(c, 404, "Order not found");
  if (order.buyerId !== user.uid && order.artisanId !== user.uid) {
    return httpError(c, 403, "Only the buyer or artisan can view this order");
  }

  const [product, buyer, artisan] = await Promise.all([
    db.getDoc<Product>(`${collections.products}/${order.productId}`),
    db.getDoc<User>(`${collections.users}/${order.buyerId}`),
    db.getDoc<User>(`${collections.users}/${order.artisanId}`),
  ]);

  return c.json({
    order,
    product: productSummary(product, order.productId),
    buyer: partySummary(buyer, order.buyerId),
    artisan: partySummary(artisan, order.artisanId),
  });
});

/**
 * POST /orders/:id/messages — the caller (buyer or artisan on this order)
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
    return httpError(c, 403, "Only the buyer or artisan can message on this order");
  }

  const message = await sendMessage(c.env, order.id, user.uid, role, text);

  const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
  const title = product?.title ?? "your order";
  const recipientId = role === "buyer" ? order.artisanId : order.buyerId;
  await createNotification(
    c.env,
    recipientId,
    "order_message",
    "New message on your order",
    `New message from the ${role === "buyer" ? "buyer" : "artisan"} on your order for "${title}".`,
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
    return httpError(c, 403, "Only the buyer or artisan can view this thread");
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
    return httpError(c, 403, "Only the buyer or artisan can mark this thread read");
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
    return httpError(c, 403, "Only the buyer or artisan can check confirmation status");
  }

  const feedbackSubmitted =
    role === "buyer" ? order.buyerFeedback != null : order.artisanFeedback != null;
  const callerConfirmed =
    role === "buyer" ? order.buyerConfirmedDelivery : order.artisanConfirmedDelivery;
  const otherConfirmed =
    role === "buyer" ? order.artisanConfirmedDelivery : order.buyerConfirmedDelivery;

  let allowed = true;
  let reason: string | null = null;
  const finalPaymentPending = order.finalAmount > 0 && order.finalPaid !== true;
  const productionStatus = order.productionStatus as string | undefined;
  const readyForDelivery = productionStatus === undefined || productionStatus === "awaiting_delivery";
  if (order.escrowStatus !== "held") {
    allowed = false;
    reason = order.escrowStatus === "pending_payment"
      ? "Payment is not held in escrow yet"
      : "This order can no longer be confirmed";
  } else if (order.hasDispute === true) {
    allowed = false;
    reason = "This order is under review by our support team";
  } else if (!readyForDelivery) {
    allowed = false;
    reason = order.paymentPlan === "deposit" && finalPaymentPending
      ? "The remaining payment for this order hasn't been completed yet"
      : "The artisan hasn't marked this piece ready for delivery yet";
  } else if (finalPaymentPending) {
    allowed = false;
    reason = "The remaining payment for this order hasn't been completed yet";
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
    productionStatus: order.productionStatus,
    finalPaymentPending,
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
    return httpError(c, 403, "Only the buyer or artisan can confirm delivery");
  }
  if (order.escrowStatus !== "held") {
    return httpError(c, 409, "Payment is not held in escrow yet");
  }
  if (order.hasDispute === true) {
    return httpError(c, 409, "This order is under review; support will contact you");
  }
  const confirmProductionStatus = order.productionStatus as string | undefined;
  const confirmReady = confirmProductionStatus === undefined || confirmProductionStatus === "awaiting_delivery";
  if (received && !confirmReady) {
    return httpError(
      c,
      409,
      order.paymentPlan === "deposit"
        ? "The remaining payment for this order hasn't been completed yet"
        : "The artisan hasn't marked this piece ready for delivery yet",
    );
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
      isBuyer ? order.artisanId : order.buyerId,
      "order_dispute",
      "Your order is under review",
      `The ${isBuyer ? "buyer" : "artisan"} reported an issue with this order. Funds stay in escrow while support reviews it.`,
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
  // Deposit plan: release pays out the whole agreed amount, so the remaining
  // balance must be in escrow before either side can confirm delivery.
  if (order.finalAmount > 0 && order.finalPaid !== true) {
    return httpError(c, 409, "The remaining payment for this order hasn't been completed yet");
  }
  const existingFeedback = isBuyer ? order.buyerFeedback : order.artisanFeedback;
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
    updates.artisanConfirmedDelivery = true;
    updates.artisanFeedback = feedback;
  }

  let updated = await db.updateDoc<Order>(`${collections.orders}/${id}`, updates);

  const buyerConfirmed = isBuyer || updated.buyerConfirmedDelivery;
  const artisanConfirmed = !isBuyer || updated.artisanConfirmedDelivery;
  const bothConfirmed =
    buyerConfirmed && artisanConfirmed && updated.buyerFeedback != null && updated.artisanFeedback != null;

  if (bothConfirmed) {
    await releaseToArtisan(c.env, updated);
    updated = (await db.getDoc<Order>(`${collections.orders}/${id}`)) ?? updated;
  }

  // Rating is about the counterpart: buyer rates the artisan, artisan rates the buyer.
  await applyUserRating(c.env, isBuyer ? order.artisanId : order.buyerId, rating);

  return c.json({ order: updated });
});

/**
 * POST /orders/:id/mark-ready — the artisan finished the piece.
 * Deposit plan -> "awaiting_final_payment" (the buyer must pay the remaining
 * balance; a 3-day cron forfeits the deposit if they never do).
 * Full prepay  -> "awaiting_delivery" and the 5-day delivery window starts.
 */
orderRoutes.post("/:id/mark-ready", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing order id");

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return httpError(c, 404, "Order not found");
  if (order.artisanId !== user.uid) {
    return httpError(c, 403, "Only the artisan working on this order can mark it ready");
  }
  if (order.productionStatus !== "in_production") {
    return httpError(c, 409, "This order is not in production");
  }
  if (order.hasDispute === true) {
    return httpError(c, 409, "This order is under review by our support team");
  }

  const now = new Date().toISOString();
  const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
  const title = product?.title ?? "your order";
  const needsFinalPayment = order.finalAmount > 0 && order.finalPaid !== true;

  let updated: Order & { id: string };
  if (needsFinalPayment) {
    updated = await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
      productionStatus: "awaiting_final_payment",
      productionStatusAt: now,
      updatedAt: now,
    });
    await createNotification(
      c.env,
      order.buyerId,
      "final_payment_due",
      "Your piece is ready — remaining balance due",
      `The artisan finished "${title}". Pay the remaining ${order.finalAmount} ${order.currency} within 3 days to have it delivered; after that the order is cancelled and the deposit is kept by the artisan.`,
      { orderId: order.id, productId: order.productId },
    );
    await createNotification(
      c.env,
      order.artisanId,
      "awaiting_final_payment",
      "Piece ready — waiting for the remaining payment",
      `You marked "${title}" as ready. The buyer has 3 days to pay the remaining ${order.finalAmount} ${order.currency} before the order is cancelled (you keep the deposit).`,
      { orderId: order.id, productId: order.productId },
    );
  } else {
    updated = await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
      productionStatus: "awaiting_delivery",
      productionStatusAt: now,
      deliveryDeadline: new Date(Date.now() + DELIVERY_DEADLINE_MS).toISOString(),
      updatedAt: now,
    });
    await createNotification(
      c.env,
      order.buyerId,
      "ready_for_delivery",
      "Your order is ready for delivery",
      `"${title}" is finished. Confirm delivery in the app once you receive it to release the payment.`,
      { orderId: order.id, productId: order.productId },
    );
    await createNotification(
      c.env,
      order.artisanId,
      "ready_for_delivery",
      "Marked ready — waiting for delivery confirmation",
      `"${title}" is marked ready. Deliver it and confirm on your side; the buyer's confirmation releases the funds.`,
      { orderId: order.id, productId: order.productId },
    );
  }

  return c.json({ order: updated });
});

/**
 * POST /orders/:id/pay-final — the buyer pays the remaining balance after the
 * artisan marks the piece ready (deposit plan only). Same provider as the
 * up-front charge: Paypack cashin for RWF, a new Pesapal hosted page for USD.
 * On confirmation the webhook/IPN moves the order to "awaiting_delivery" and
 * starts the 5-day delivery window.
 */
orderRoutes.post("/:id/pay-final", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing order id");

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    // A bare POST is fine for RWF buyers with a stored phone number.
  }

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return httpError(c, 404, "Order not found");
  if (order.buyerId !== user.uid) {
    return httpError(c, 403, "Only the buyer can pay the remaining balance");
  }
  if (order.productionStatus !== "awaiting_final_payment") {
    return httpError(c, 409, "This order is not waiting for a remaining payment");
  }
  if (order.finalPaid === true) {
    return httpError(c, 409, "The remaining payment was already received");
  }
  if (!(order.finalAmount > 0)) {
    return httpError(c, 409, "There is no remaining balance on this order");
  }
  // Idempotent: a remaining-balance charge is already in flight (the webhook
  // clears this on failure so the buyer can retry).
  if (order.finalPaymentReference) {
    return c.json({ order });
  }

  const now = new Date().toISOString();

  if (order.currency === "RWF") {
    const provided = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
    const phoneNumber = provided || order.buyerPhoneNumber || "";
    if (!PHONE_RE.test(phoneNumber)) {
      return httpError(c, 400, "A valid phone number is required for mobile money");
    }
    try {
      const { ref } = await paypackFromEnv(c.env).cashin(
        order.finalAmount,
        phoneNumber,
        `${order.id}-final`,
      );
      const updated = await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
        finalPaymentReference: ref,
        buyerPhoneNumber: phoneNumber,
        updatedAt: now,
      });
      return c.json({ order: updated });
    } catch (err) {
      // The deposit stays in escrow and the order keeps waiting; retryable.
      return c.json({
        error: err instanceof Error ? err.message : "Failed to start mobile money payment",
      }, 502);
    }
  }

  // USD -> a second Pesapal hosted payment page for the remaining balance.
  try {
    const notificationId = await ensurePesapalIpnId(c);
    const [product, buyer] = await Promise.all([
      db.getDoc<Product>(`${collections.products}/${order.productId}`),
      db.getDoc<User>(`${collections.users}/${order.buyerId}`),
    ]);
    const nameParts = (buyer?.name ?? "").split(" ");
    const { orderTrackingId, redirectUrl } = await pesapalFromEnv(c.env).submitOrder({
      id: `${order.id}-final`,
      amount: order.finalAmount,
      currency: order.currency,
      description: product?.title ?? `Remaining balance for order ${order.id}`,
      callbackUrl: `${c.env.FRONTEND_URL ?? "http://localhost:3000"}/checkout/callback?orderId=${order.id}`,
      notificationId,
      billingAddress: {
        emailAddress: buyer?.email ?? "",
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
    const updated = await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
      finalPaymentReference: orderTrackingId,
      updatedAt: now,
    });
    return c.json({ order: updated, redirectUrl });
  } catch (err) {
    return c.json({
      error: err instanceof Error ? err.message : "Failed to start card payment",
    }, 502);
  }
});

/**
 * POST /orders/:id/request-cancellation — the buyer asks to cancel while the
 * piece is in production. The artisan then accepts (escrow split) or rejects
 * (production continues) via /respond-cancellation.
 */
orderRoutes.post("/:id/request-cancellation", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing order id");

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return httpError(c, 400, "Invalid JSON body");
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 1 || reason.length > 1000) {
    return httpError(c, 400, "reason must be 1-1000 characters");
  }

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return httpError(c, 404, "Order not found");
  if (order.buyerId !== user.uid) {
    return httpError(c, 403, "Only the buyer can request cancellation");
  }
  if (order.productionStatus !== "in_production") {
    return httpError(c, 409, "Cancellation is only possible while the order is in production");
  }
  if (order.cancellationRequest) {
    return httpError(c, 409, "A cancellation request already exists for this order");
  }

  const now = new Date().toISOString();
  const updated = await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
    cancellationRequest: {
      requestedBy: "buyer",
      reason,
      requestedAt: now,
      artisanDecision: "pending",
      decidedAt: null,
    },
    updatedAt: now,
  });

  await createNotification(
    c.env,
    order.artisanId,
    "cancellation_requested",
    "Buyer requested a cancellation",
    `The buyer asked to cancel this order: "${reason}". Accept to split the escrowed payment (you keep 25% of the order total for the work completed), or reject to continue production.`,
    { orderId: order.id, productId: order.productId },
  );
  await createNotification(
    c.env,
    order.buyerId,
    "cancellation_requested",
    "Cancellation request sent",
    "The artisan will review your cancellation request. You'll be notified as soon as they accept or reject it.",
    { orderId: order.id, productId: order.productId },
  );

  return c.json({ order: updated });
});

/**
 * POST /orders/:id/respond-cancellation — the artisan decides the pending
 * request. Reject: production continues. Accept: escrow is split — the artisan
 * keeps 25% of the order total (work completed, credited to their wallet) and
 * the buyer is refunded everything else that was held. The product returns to
 * "active" either way the order ends.
 */
orderRoutes.post("/:id/respond-cancellation", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return httpError(c, 400, "Missing order id");

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return httpError(c, 400, "Invalid JSON body");
  }
  if (typeof body.accept !== "boolean") {
    return httpError(c, 400, "accept must be a boolean");
  }
  const accept = body.accept;

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return httpError(c, 404, "Order not found");
  if (order.artisanId !== user.uid) {
    return httpError(c, 403, "Only the artisan can respond to a cancellation request");
  }
  if (order.productionStatus !== "in_production") {
    return httpError(c, 409, "This order is no longer in production");
  }
  const request = order.cancellationRequest;
  if (!request || request.artisanDecision !== "pending") {
    return httpError(c, 409, "There is no pending cancellation request on this order");
  }

  const now = new Date().toISOString();

  if (!accept) {
    const updated = await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
      cancellationRequest: { ...request, artisanDecision: "rejected", decidedAt: now },
      updatedAt: now,
    });
    await createNotification(
      c.env,
      order.buyerId,
      "cancellation_rejected",
      "Cancellation declined — production continues",
      "The artisan declined the cancellation request and is continuing to make your piece. You can still raise an issue if something goes wrong.",
      { orderId: order.id, productId: order.productId },
    );
    return c.json({ order: updated });
  }

  // Accept: split what is held in escrow — artisan keeps 25% of the order
  // total, the buyer gets the rest of the held amount back.
  const held = heldAmountFor(order);
  let artisanShare = round2(order.totalPaid * 0.25);
  if (artisanShare > held) artisanShare = held;
  const refundAmount = round2(held - artisanShare);

  // Push the buyer's share back first (idempotency-keyed), then CAS the order
  // and credit the artisan's wallet in one commit.
  let nextEscrowStatus: Order["escrowStatus"];
  try {
    if (order.paymentProvider === "paypack") {
      if (refundAmount > 0) {
        if (!order.buyerPhoneNumber) {
          return httpError(c, 409, "The buyer's phone number is unavailable for the refund");
        }
        await paypackFromEnv(c.env).cashout(
          refundAmount,
          order.buyerPhoneNumber,
          `cancel-${order.id}`,
        );
      }
      nextEscrowStatus = "refunded";
    } else {
      if (refundAmount > 0) {
        await pesapalFromEnv(c.env).refundRequest({
          confirmationCode: order.paymentReference,
          amount: refundAmount,
          username: order.buyerId,
          remarks: "Cancellation accepted by artisan — partial refund",
        });
      }
      nextEscrowStatus = "refund_requested";
    }
  } catch (err) {
    return c.json({
      error: err instanceof Error ? err.message : "Failed to refund the buyer",
    }, 502);
  }

  const snap = await db.getDocWithTime<Order>(`${collections.orders}/${order.id}`);
  if (!snap || snap.doc.escrowStatus !== "held" || snap.doc.cancellationRequest?.artisanDecision !== "pending") {
    return httpError(c, 409, "This order changed while processing the cancellation");
  }

  const txId = crypto.randomUUID();
  const committed = await db.commitWithCreate<WalletTransaction>(
    `${collections.orders}/${order.id}`,
    {
      escrowStatus: nextEscrowStatus,
      productionStatus: "cancelled_by_mutual_agreement",
      productionStatusAt: now,
      cancellationRequest: { ...request, artisanDecision: "accepted", decidedAt: now },
      updatedAt: now,
    },
    snap.updateTime,
    collections.walletTransactions,
    {
      userId: order.artisanId,
      orderId: order.id,
      type: "credit",
      amount: artisanShare,
      currency: order.currency,
      createdAt: now,
    },
    txId,
    artisanShare > 0
      ? [{ path: `${collections.users}/${order.artisanId}`, field: "walletBalance", delta: artisanShare }]
      : [],
  );
  if (!committed) {
    return httpError(c, 409, "This order changed while processing the cancellation");
  }

  if (refundAmount > 0) {
    await db.createDoc<WalletTransaction>(collections.walletTransactions, undefined, {
      userId: order.buyerId,
      orderId: order.id,
      type: "refund",
      amount: refundAmount,
      currency: order.currency,
      createdAt: now,
    });
  }

  const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
  if (product && product.status !== "removed" && product.artisanId === order.artisanId) {
    await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
      status: "active",
      reservedBy: null,
      reservedUntil: null,
      updatedAt: now,
    });
  }
  // The cancelled order frees a made-to-order slot.
  await adjustMadeToOrderSlots(c.env, order.productId, -1);

  await createNotification(
    c.env,
    order.buyerId,
    "cancellation_accepted",
    "Order cancelled by agreement",
    `The artisan accepted the cancellation. ${refundAmount} ${order.currency} is coming back to you; the artisan keeps ${artisanShare} ${order.currency} for the work completed.`,
    { orderId: order.id, productId: order.productId },
  );
  await createNotification(
    c.env,
    order.artisanId,
    "cancellation_accepted",
    "Cancellation accepted — split complete",
    `You kept ${artisanShare} ${order.currency} for the work completed and ${refundAmount} ${order.currency} was returned to the buyer.`,
    { orderId: order.id, productId: order.productId },
  );

  const updated = await db.getDoc<Order>(`${collections.orders}/${order.id}`);
  return c.json({ order: updated ?? snap.doc });
});
