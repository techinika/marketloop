import { Hono } from "hono";

import { firestoreFromEnv } from "../lib/firestore";
import { httpError } from "../lib/http";
import { createNotification } from "../lib/notify";
import { paypackFromEnv } from "../lib/paypack";
import { pesapalFromEnv } from "../lib/pesapal";
import { collections, type Order, type Product } from "../models";
import type { AppEnv, Env } from "../types";
import { DELIVERY_DEADLINE_MS } from "../lib/escrow";

export const webhookRoutes = new Hono<AppEnv>();

/** Notifies both parties that payment is held in escrow and delivery begins. */
async function notifyPaymentHeld(env: Env, order: Order & { id: string }): Promise<void> {
  await createNotification(
    env,
    order.sellerId,
    "payment_held",
    "Payment received — deliver now",
    "The buyer's payment arrived and is held safely. Arrange delivery and confirm once done.",
    { orderId: order.id, productId: order.productId },
  );
  await createNotification(
    env,
    order.buyerId,
    "payment_held",
    "Payment held safely",
    "Your payment is held in escrow until you confirm delivery.",
    { orderId: order.id, productId: order.productId },
  );
}

/**
 * POST /webhooks/paypack — Paypack calls this when a cashin/cashout changes
 * status. Signature-verified with X-Paypack-Signature. On a successful CASHIN
 * the order moves to "held" (5-day delivery deadline) and the product is sold.
 */
webhookRoutes.post("/paypack", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("X-Paypack-Signature") ?? null;

  const valid = await paypackFromEnv(c.env).verifyWebhookSignature(rawBody, signature);
  if (!valid) {
    console.error("Paypack webhook: signature verification failed.");
    return httpError(c, 401, "Invalid signature");
  }

  let event: {
    ref?: unknown;
    status?: unknown;
    kind?: unknown;
    amount?: unknown;
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return httpError(c, 400, "Invalid webhook body");
  }

  const ref = typeof event.ref === "string" ? event.ref : null;
  const status = typeof event.status === "string" ? event.status : "";
  const kind = typeof event.kind === "string" ? event.kind : "";

  if (kind !== "CASHIN") {
    // Cashouts (withdrawals/refunds) don't change order state; just ack.
    return c.json({ status: 200 });
  }
  if (!ref) return httpError(c, 400, "Missing ref");

  const db = firestoreFromEnv(c.env);
  const now = new Date().toISOString();
  const found = await db.queryCollection<Order>(collections.orders, {
    filters: [{ field: "paymentReference", op: "==", value: ref }],
    limit: 1,
  });
  const order = found[0];
  if (!order) {
    console.error(`Paypack webhook: no order for ref ${ref}`);
    return c.json({ status: 200 });
  }

  if (order.escrowStatus === "held" || order.escrowStatus === "released") {
    // Duplicate/retried notification — already processed.
    return c.json({ status: 200 });
  }

  if (status === "successful") {
    await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
      escrowStatus: "held",
      deliveryDeadline: new Date(Date.now() + DELIVERY_DEADLINE_MS).toISOString(),
      updatedAt: now,
    });
    await notifyPaymentHeld(c.env, order);
    const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
    if (product && product.sellerId === order.sellerId && product.status !== "removed") {
      await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
        status: "sold",
        reservedBy: null,
        reservedUntil: null,
        updatedAt: now,
      });
    }
  } else if (status === "failed") {
    await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
      escrowStatus: "failed",
      updatedAt: now,
    });
    const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
    if (product && product.sellerId === order.sellerId) {
      await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
        status: "active",
        reservedBy: null,
        reservedUntil: null,
        updatedAt: now,
      });
    }
  }

  return c.json({ status: 200 });
});

/**
 * GET/POST /webhooks/pesapal-ipn — Pesapal IPN (may arrive via GET or POST).
 * Looks up the transaction by order_tracking_id and reconciles the order.
 *
 * Pesapal's IPN does not sign its payload, so authenticity is hardened two ways:
 *  1. An optional PESAPAL_IPN_SECRET query param is appended to the registered
 *     IPN URL and must be present/valid on every callback. If the secret is
 *     configured, requests without it are rejected.
 *  2. If the order is still pending and the status reports COMPLETED, the
 *     reported transaction amount must match order.totalPaid, otherwise the
 *     order is flagged as failed rather than moved to "held".
 */
webhookRoutes.all("/pesapal-ipn", async (c) => {
  const ipnSecret = c.env.PESAPAL_IPN_SECRET;
  if (ipnSecret) {
    const provided = c.req.query("secret");
    if (provided !== ipnSecret) {
      console.error("Pesapal IPN: missing/invalid secret.");
      return c.json({ status: 401 }, 401);
    }
  }

  const query = c.req.query("orderTrackingId") ?? c.req.query("OrderTrackingId");
  let orderTrackingId = query ?? null;

  if (!orderTrackingId) {
    try {
      const body = await c.req.json().catch(() => null);
      orderTrackingId = (body as { orderTrackingId?: string } | null)?.orderTrackingId ?? null;
    } catch {
      orderTrackingId = null;
    }
  }

  const respond = (extra: Record<string, unknown> = {}) =>
    c.json({
      orderNotificationType: "GET",
      orderTrackingId: orderTrackingId ?? "",
      orderMerchantReference: "",
      status: 200,
      ...extra,
    });

  if (!orderTrackingId) {
    return c.json(
      {
        orderNotificationType: "GET",
        orderTrackingId: "",
        orderMerchantReference: "",
        status: 200,
      },
      400,
    );
  }

  let tx: Record<string, unknown>;
  try {
    tx = await pesapalFromEnv(c.env).getTransactionStatus(orderTrackingId);
  } catch (err) {
    console.error(`Pesapal IPN: status lookup failed for ${orderTrackingId}`, err);
    return c.json({
      orderNotificationType: "GET",
      orderTrackingId,
      orderMerchantReference: "",
      status: 500,
    }, 502);
  }

  const statusCode = Number(tx.status_code ?? -1);
  const merchantReference = typeof tx.merchant_reference === "string" ? tx.merchant_reference : "";
  const db = firestoreFromEnv(c.env);
  const now = new Date().toISOString();
  const found = await db.queryCollection<Order>(collections.orders, {
    filters: [{ field: "paymentReference", op: "==", value: orderTrackingId }],
    limit: 1,
  });
  const order = found[0];

  if (order && order.escrowStatus !== "held" && order.escrowStatus !== "released") {
    if (statusCode === 1) {
      // COMPLETED — verify the reported amount matches before moving to escrow.
      const reportedAmount = Number(tx.amount);
      const amountMatch =
        Number.isFinite(reportedAmount) &&
        Math.abs(reportedAmount - order.totalPaid) < 0.01;
      if (!amountMatch) {
        console.error(
          `Pesapal IPN: amount mismatch for ${orderTrackingId}: reported ${reportedAmount}, expected ${order.totalPaid}.`,
        );
        await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
          escrowStatus: "failed",
          updatedAt: now,
        });
        const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
        if (product && product.sellerId === order.sellerId) {
          await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
            status: "active",
            reservedBy: null,
            reservedUntil: null,
            updatedAt: now,
          });
        }
        return respond({ orderMerchantReference: merchantReference });
      }
      await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
        escrowStatus: "held",
        deliveryDeadline: new Date(Date.now() + DELIVERY_DEADLINE_MS).toISOString(),
        updatedAt: now,
      });
      await notifyPaymentHeld(c.env, order);
      const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
      if (product && product.sellerId === order.sellerId && product.status !== "removed") {
        await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
          status: "sold",
          reservedBy: null,
          reservedUntil: null,
          updatedAt: now,
        });
      }
    } else if (statusCode === 2 || statusCode === 3) {
      // FAILED / REVERSED
      await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
        escrowStatus: "failed",
        updatedAt: now,
      });
      const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
      if (product && product.sellerId === order.sellerId) {
        await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
          status: "active",
          reservedBy: null,
          reservedUntil: null,
          updatedAt: now,
        });
      }
    }
  }

  return respond({ orderMerchantReference: merchantReference });
});
