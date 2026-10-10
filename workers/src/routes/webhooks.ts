import { Hono } from "hono";

import { firestoreFromEnv, type FirestoreClient } from "../lib/firestore";
import { httpError } from "../lib/http";
import { decrementReadyToShipStock } from "../lib/inventory";
import { adjustMadeToOrderSlots } from "../lib/inventory";
import { createNotification } from "../lib/notify";
import { paypackFromEnv } from "../lib/paypack";
import { pesapalFromEnv } from "../lib/pesapal";
import { collections, type Order, type Product } from "../models";
import type { AppEnv, Env } from "../types";
import { DELIVERY_DEADLINE_MS } from "../lib/escrow";

export const webhookRoutes = new Hono<AppEnv>();

/**
 * Finds the order a provider reference belongs to. Deposit plans take two
 * charges (up-front + remaining balance), each with its own ref/tracking id, so
 * both fields are searched and `isFinal` tells the caller which charge landed.
 */
async function findOrderByReference(
  db: FirestoreClient,
  reference: string,
): Promise<{ order: Order & { id: string }; isFinal: boolean } | null> {
  const initial = await db.queryCollection<Order>(collections.orders, {
    filters: [{ field: "paymentReference", op: "==", value: reference }],
    limit: 1,
  });
  if (initial[0]) return { order: initial[0], isFinal: false };
  const final = await db.queryCollection<Order>(collections.orders, {
    filters: [{ field: "finalPaymentReference", op: "==", value: reference }],
    limit: 1,
  });
  if (final[0]) return { order: final[0], isFinal: true };
  return null;
}

/** True while the up-front charge left a remaining balance to collect later. */
function needsFinalPayment(order: Order): boolean {
  return order.finalAmount > 0 && order.finalPaid !== true;
}

/** Notifies both parties that escrow now holds the buyer's money. */
async function notifyPaymentHeld(env: Env, order: Order & { id: string }): Promise<void> {
  const depositOnly = order.paymentPlan === "deposit" && needsFinalPayment(order);
  await createNotification(
    env,
    order.artisanId,
    "payment_held",
    "Payment received — start production",
    depositOnly
      ? "The buyer's deposit is held safely. Make the piece to order, then mark it ready for delivery to collect the remaining balance."
      : "The buyer's payment arrived and is held safely. Make the piece to order, then mark it ready for delivery.",
    { orderId: order.id, productId: order.productId },
  );
  await createNotification(
    env,
    order.buyerId,
    "payment_held",
    "Payment held safely",
    depositOnly
      ? "Your deposit is held in escrow. The remaining balance is due when the artisan marks the piece ready."
      : "Your payment is held in escrow until you confirm delivery.",
    { orderId: order.id, productId: order.productId },
  );
}

/** Notifies both parties that the remaining balance (deposit plan) landed. */
async function notifyFinalPaymentReceived(env: Env, order: Order & { id: string }): Promise<void> {
  await createNotification(
    env,
    order.artisanId,
    "final_payment_received",
    "Remaining payment received — deliver now",
    "The buyer paid the remaining balance; the full amount is held in escrow. Arrange delivery and confirm once done.",
    { orderId: order.id, productId: order.productId },
  );
  await createNotification(
    env,
    order.buyerId,
    "final_payment_received",
    "Remaining payment received",
    "Your remaining payment is held in escrow. Confirm delivery once your piece arrives to release the funds.",
    { orderId: order.id, productId: order.productId },
  );
}

/** Notifies both parties that a ready-to-ship purchase is paid and ships now. */
async function notifyReadyToShipHeld(env: Env, order: Order & { id: string }): Promise<void> {
  await createNotification(
    env,
    order.artisanId,
    "payment_held",
    "Payment received — ship the item",
    "The buyer's payment arrived and is held safely. Ship the item and confirm delivery once done.",
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
 * the order moves to "held" and production starts; the remaining-balance charge
 * (deposit plan) instead completes escrow and starts the delivery window.
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
  const found = await findOrderByReference(db, ref);
  if (!found) {
    console.error(`Paypack webhook: no order for ref ${ref}`);
    return c.json({ status: 200 });
  }
  const { order, isFinal } = found;
  const isRts = order.productType === "ready_to_ship";

  // Duplicate/retried notification guards. The remaining-balance charge only
  // applies while the order is still waiting for it; the up-front charge is
  // done once escrow is no longer pending/failed.
  if (isFinal) {
    if (order.finalPaid === true || order.productionStatus !== "awaiting_final_payment") {
      return c.json({ status: 200 });
    }
  } else if (
    order.escrowStatus === "held" ||
    order.escrowStatus === "released" ||
    order.escrowStatus === "refunded" ||
    order.escrowStatus === "refund_requested"
  ) {
    return c.json({ status: 200 });
  }

  if (status === "successful") {
    if (isFinal) {
      // Remaining balance (deposit plan): escrow already holds the deposit, so
      // the money side only flips finalPaid; the delivery window starts now.
      await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
        finalPaid: true,
        productionStatus: "awaiting_delivery",
        productionStatusAt: now,
        deliveryDeadline: new Date(Date.now() + DELIVERY_DEADLINE_MS).toISOString(),
        updatedAt: now,
      });
      await notifyFinalPaymentReceived(c.env, order);
      return c.json({ status: 200 });
    }

    if (isRts) {
      // Ready-to-ship: fully paid, skip production; the piece ships now and the
      // buyer has a delivery window to confirm receipt. Sold units are deducted
      // from stock (never flips to "sold" — only sold_out at zero).
      await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
        escrowStatus: "held",
        depositPaid: true,
        finalPaid: true,
        productionStatus: "awaiting_delivery",
        productionStatusAt: now,
        deliveryDeadline: new Date(Date.now() + DELIVERY_DEADLINE_MS).toISOString(),
        updatedAt: now,
      });
      await notifyReadyToShipHeld(c.env, order);
      await decrementReadyToShipStock(c.env, order.productId, order.quantity ?? 1);
      return c.json({ status: 200 });
    }

    const startsProduction = order.productionStatus === "pending_deposit";
    await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
      escrowStatus: "held",
      depositPaid: true,
      // Full prepay (or a zero balance): nothing left to charge.
      finalPaid: !needsFinalPayment(order),
      productionStatus: startsProduction ? "in_production" : order.productionStatus,
      productionStatusAt: startsProduction ? now : order.productionStatusAt,
      updatedAt: now,
    });
    await notifyPaymentHeld(c.env, order);
    const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
    if (product && product.artisanId === order.artisanId && product.status !== "removed") {
      await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
        status: "sold",
        reservedBy: null,
        reservedUntil: null,
        updatedAt: now,
      });
    }
  } else if (status === "failed") {
    if (isFinal) {
      // The remaining-balance charge failed: the deposit stays in escrow and
      // the order keeps waiting so the buyer can retry pay-final.
      await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
        finalPaymentReference: null,
        updatedAt: now,
      });
      await createNotification(
        c.env,
        order.buyerId,
        "final_payment_failed",
        "Remaining payment failed",
        `The payment of ${order.finalAmount} ${order.currency} for the remaining balance didn't go through. Please try again so the artisan can deliver.`,
        { orderId: order.id, productId: order.productId },
      );
      return c.json({ status: 200 });
    }
    // Already counted this failure (provider retries): don't release the slot twice.
    if (order.escrowStatus === "failed") {
      return c.json({ status: 200 });
    }
    await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
      escrowStatus: "failed",
      updatedAt: now,
    });
    if (!isRts) {
      // A failed made-to-order frees its slot and returns the item to the feed.
      await adjustMadeToOrderSlots(c.env, order.productId, -1);
      const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
      if (product && product.artisanId === order.artisanId) {
        await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
          status: "active",
          reservedBy: null,
          reservedUntil: null,
          updatedAt: now,
        });
      }
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
 *     reported transaction amount must match the charge that tracking id was
 *     issued for (the remaining balance when it's the final charge, otherwise
 *     the up-front amount), otherwise the order is flagged as failed rather
 *     than moved to "held".
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
  const found = await findOrderByReference(db, orderTrackingId);

  if (found) {
    const { order, isFinal } = found;
    const isRts = order.productType === "ready_to_ship";

    // Ignore notifications for charges that already settled (or an order that
    // moved on — cancelled/refunded) so retries can't double-apply money.
    const settled = isFinal
      ? order.finalPaid === true || order.productionStatus !== "awaiting_final_payment"
      : order.escrowStatus === "held" ||
        order.escrowStatus === "released" ||
        order.escrowStatus === "refunded" ||
        order.escrowStatus === "refund_requested";

    if (!settled) {
      if (statusCode === 1) {
        // COMPLETED — verify the reported amount matches this charge.
        const expectedAmount = isFinal
          ? order.finalAmount
          : Number.isFinite(order.depositAmount)
            ? order.depositAmount
            : order.totalPaid;
        const reportedAmount = Number(tx.amount);
        const amountMatch =
          Number.isFinite(reportedAmount) &&
          Math.abs(reportedAmount - expectedAmount) < 0.01;
        if (!amountMatch) {
          console.error(
            `Pesapal IPN: amount mismatch for ${orderTrackingId}: reported ${reportedAmount}, expected ${expectedAmount}.`,
          );
          if (isFinal) {
            // Remaining-balance mismatch never fails the order: the deposit
            // stays in escrow and the buyer can retry pay-final.
            await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
              finalPaymentReference: null,
              updatedAt: now,
            });
            return respond({ orderMerchantReference: merchantReference });
          }
          await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
            escrowStatus: "failed",
            updatedAt: now,
          });
          if (!isRts) {
            await adjustMadeToOrderSlots(c.env, order.productId, -1);
            const mismatched = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
            if (mismatched && mismatched.artisanId === order.artisanId) {
              await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
                status: "active",
                reservedBy: null,
                reservedUntil: null,
                updatedAt: now,
              });
            }
          }
          return respond({ orderMerchantReference: merchantReference });
        }

        if (isFinal) {
          await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
            finalPaid: true,
            productionStatus: "awaiting_delivery",
            productionStatusAt: now,
            deliveryDeadline: new Date(Date.now() + DELIVERY_DEADLINE_MS).toISOString(),
            updatedAt: now,
          });
          await notifyFinalPaymentReceived(c.env, order);
          return respond({ orderMerchantReference: merchantReference });
        }

        if (isRts) {
          // Ready-to-ship: fully paid, ship now; sold units come out of stock.
          await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
            escrowStatus: "held",
            depositPaid: true,
            finalPaid: true,
            productionStatus: "awaiting_delivery",
            productionStatusAt: now,
            deliveryDeadline: new Date(Date.now() + DELIVERY_DEADLINE_MS).toISOString(),
            updatedAt: now,
          });
          await notifyReadyToShipHeld(c.env, order);
          await decrementReadyToShipStock(c.env, order.productId, order.quantity ?? 1);
          return respond({ orderMerchantReference: merchantReference });
        }

        const startsProduction = order.productionStatus === "pending_deposit";
        await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
          escrowStatus: "held",
          depositPaid: true,
          finalPaid: !needsFinalPayment(order),
          productionStatus: startsProduction ? "in_production" : order.productionStatus,
          productionStatusAt: startsProduction ? now : order.productionStatusAt,
          updatedAt: now,
        });
        await notifyPaymentHeld(c.env, order);
        const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
        if (product && product.artisanId === order.artisanId && product.status !== "removed") {
          await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
            status: "sold",
            reservedBy: null,
            reservedUntil: null,
            updatedAt: now,
          });
        }
      } else if (statusCode === 2 || statusCode === 3) {
        // FAILED / REVERSED
        if (isFinal) {
          await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
            finalPaymentReference: null,
            updatedAt: now,
          });
          await createNotification(
            c.env,
            order.buyerId,
            "final_payment_failed",
            "Remaining payment failed",
            `The payment of ${order.finalAmount} ${order.currency} for the remaining balance didn't go through. Please try again so the artisan can deliver.`,
            { orderId: order.id, productId: order.productId },
          );
          return respond({ orderMerchantReference: merchantReference });
        }
        // Provider retries: don't release the slot twice.
        if (order.escrowStatus === "failed") {
          return respond({ orderMerchantReference: merchantReference });
        }
        await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
          escrowStatus: "failed",
          updatedAt: now,
        });
        if (!isRts) {
          await adjustMadeToOrderSlots(c.env, order.productId, -1);
          const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
          if (product && product.artisanId === order.artisanId) {
            await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
              status: "active",
              reservedBy: null,
              reservedUntil: null,
              updatedAt: now,
            });
          }
        }
      }
    }
  }

  return respond({ orderMerchantReference: merchantReference });
});
