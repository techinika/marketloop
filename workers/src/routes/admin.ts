import { Hono } from "hono";
import type { Context } from "hono";

import { firestoreFromEnv, type WithId } from "../lib/firestore";
import { releaseToSeller } from "../lib/escrow";
import { createNotification } from "../lib/notify";
import { adminAuthMiddleware } from "../middleware/admin";
import type { AuthUser } from "../lib/firebase-auth";
import {
  collections,
  type Order,
  type Product,
  type User,
  type WalletTransaction,
} from "../models";
import type { Env } from "../types";

export type AdminRoutesEnv = {
  Bindings: Env;
  Variables: { user: AuthUser; adminUser: WithId<User> };
};

export const adminRoutes = new Hono<AdminRoutesEnv>();

adminRoutes.use("*", adminAuthMiddleware);

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True when an order needs an admin's eyes: USD refunds waiting on the
 * provider, or held orders approaching their delivery deadline. */
function needsAttentionFor(order: Order & { id: string }): boolean {
  if (order.escrowStatus === "refund_requested" && order.currency === "USD") return true;
  if (order.escrowStatus === "held" && order.deliveryDeadline) {
    const ms = new Date(order.deliveryDeadline).getTime() - Date.now();
    if (ms > 0 && ms <= REMINDER_WINDOW_MS) return true;
  }
  return false;
}

async function parseBody(c: Context<AdminRoutesEnv>): Promise<Record<string, unknown>> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** GET /admin/orders — all orders, filterable by escrowStatus, needs-attention pinned first. */
adminRoutes.get("/orders", async (c) => {
  const status = (c.req.query("status") ?? "").trim();
  const page = Math.max(1, Number(c.req.query("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? "50")));

  const db = firestoreFromEnv(c.env);
  const orders = await db.queryCollection<Order>(collections.orders, {
    filters: status ? [{ field: "escrowStatus", op: "==", value: status }] : [],
    orderBy: { field: "createdAt", direction: "DESCENDING" },
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });

  const rows = await Promise.all(
    orders.map(async (order) => {
      const [buyer, seller, product] = await Promise.all([
        db.getDoc<User>(`${collections.users}/${order.buyerId}`),
        db.getDoc<User>(`${collections.users}/${order.sellerId}`),
        db.getDoc<Product>(`${collections.products}/${order.productId}`),
      ]);
      return {
        id: order.id,
        escrowStatus: order.escrowStatus,
        agreedAmount: order.agreedAmount,
        totalPaid: order.totalPaid,
        currency: order.currency,
        deliveryFee: order.deliveryFee,
        deliveryFeePayer: order.deliveryFeePayer,
        paymentProvider: order.paymentProvider,
        paymentReference: order.paymentReference,
        createdAt: order.createdAt,
        deliveryDeadline: order.deliveryDeadline,
        buyer: buyer
          ? { uid: buyer.uid, name: buyer.name, email: buyer.email }
          : { uid: order.buyerId, name: "Unknown", email: null },
        seller: seller
          ? { uid: seller.uid, name: seller.name, email: seller.email }
          : { uid: order.sellerId, name: "Unknown", email: null },
        product: product
          ? { id: product.id, title: product.title }
          : { id: order.productId, title: "Unknown" },
        needsAttention: needsAttentionFor(order),
      };
    }),
  );

  rows.sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention));

  return c.json({ orders: rows, page, pageSize });
});

/** GET /admin/orders/:id — full order detail plus linked wallet transactions. */
adminRoutes.get("/orders/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing order id" }, 400);

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return c.json({ error: "Order not found" }, 404);

  const [product, buyer, seller, transactions] = await Promise.all([
    db.getDoc<Product>(`${collections.products}/${order.productId}`),
    db.getDoc<User>(`${collections.users}/${order.buyerId}`),
    db.getDoc<User>(`${collections.users}/${order.sellerId}`),
    db.queryCollection<WalletTransaction>(collections.walletTransactions, {
      filters: [{ field: "orderId", op: "==", value: order.id }],
    }),
  ]);

  return c.json({ order, product, buyer, seller, transactions });
});

/**
 * POST /admin/orders/:id/mark-refunded — admin confirms (on the Pesapal
 * dashboard) that a requested refund was finalized. Moves the order to
 * "refunded" and, if the cron hadn't recorded it yet, adds the buyer's refund
 * wallet transaction.
 */
adminRoutes.post("/orders/:id/mark-refunded", async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing order id" }, 400);
  const body = await parseBody(c);
  const adminNote = typeof body.adminNote === "string" ? body.adminNote.trim() : "";

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return c.json({ error: "Order not found" }, 404);
  if (order.escrowStatus !== "refund_requested") {
    return c.json({ error: "Only refund_requested orders can be marked refunded" }, 409);
  }

  const now = new Date().toISOString();

  // Idempotency: the auto-refund cron already records a refund tx at request
  // time; don't double-count it when the admin confirms.
  const existingRefunds = await db.queryCollection<WalletTransaction>(collections.walletTransactions, {
    filters: [
      { field: "orderId", op: "==", value: order.id },
      { field: "type", op: "==", value: "refund" },
    ],
  });
  if (existingRefunds.length === 0) {
    await db.createDoc<WalletTransaction>(collections.walletTransactions, undefined, {
      userId: order.buyerId,
      orderId: order.id,
      type: "refund",
      amount: order.totalPaid,
      currency: order.currency,
      createdAt: now,
    });
  }

  const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
  if (product && product.status === "sold" && product.sellerId === order.sellerId) {
    await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
      status: "active",
      reservedBy: null,
      reservedUntil: null,
      updatedAt: now,
    });
  }

  const updated = await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
    escrowStatus: "refunded",
    adminAction: "mark-refunded",
    adminNote: adminNote || null,
    adminUid: c.get("adminUser").uid,
    adminActionAt: now,
    updatedAt: now,
  });

  await createNotification(
    c.env,
    order.buyerId,
    "order_refunded",
    "Refund completed",
    `Your refund of ${order.totalPaid} ${order.currency} for order ${order.id} was completed by the payment provider.`,
    { orderId: order.id, productId: order.productId },
  );

  return c.json({ order: updated });
});

/**
 * POST /admin/orders/:id/force-release — releases held funds to the seller
 * wallet without both-party confirmation (admin verified delivery). Requires
 * an adminNote explaining why.
 */
adminRoutes.post("/orders/:id/force-release", async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing order id" }, 400);
  const body = await parseBody(c);
  const adminNote = typeof body.adminNote === "string" ? body.adminNote.trim() : "";
  if (!adminNote) {
    return c.json({ error: "adminNote is required to force-release funds" }, 400);
  }

  const db = firestoreFromEnv(c.env);
  const order = await db.getDoc<Order>(`${collections.orders}/${id}`);
  if (!order) return c.json({ error: "Order not found" }, 404);
  if (order.escrowStatus !== "held") {
    return c.json({ error: "Only held orders can be force-released" }, 409);
  }

  const now = new Date().toISOString();
  await releaseToSeller(c.env, order);

  const updated = await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
    escrowStatus: "released",
    buyerConfirmedDelivery: true,
    sellerConfirmedDelivery: true,
    adminAction: "force-release",
    adminNote,
    adminUid: c.get("adminUser").uid,
    adminActionAt: now,
    updatedAt: now,
  });

  return c.json({ order: updated });
});

/** GET /admin/users — paginated user list with wallet + listing/order counts. */
adminRoutes.get("/users", async (c) => {
  const search = (c.req.query("search") ?? "").trim().toLowerCase();
  const page = Math.max(1, Number(c.req.query("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? "50")));

  const db = firestoreFromEnv(c.env);
  const users = await db.queryCollection<User>(collections.users, {
    orderBy: { field: "createdAt", direction: "DESCENDING" },
  });

  let filtered = users;
  if (search) {
    filtered = users.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(search) ||
        (u.email ?? "").toLowerCase().includes(search),
    );
  }

  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  const rows = await Promise.all(
    slice.map(async (user) => {
      const [products, orders] = await Promise.all([
        db.queryCollection<Product>(collections.products, {
          filters: [{ field: "sellerId", op: "==", value: user.uid }],
        }),
        db.queryCollection<Order>(collections.orders, {
          filters: [{ field: "buyerId", op: "==", value: user.uid }],
        }),
      ]);
      return {
        uid: user.uid,
        name: user.name,
        email: user.email,
        photoUrl: user.photoUrl,
        phone: user.phone,
        walletBalance: user.walletBalance,
        createdAt: user.createdAt,
        isAdmin: user.isAdmin === true,
        productCount: products.length,
        orderCount: orders.length,
      };
    }),
  );

  return c.json({ users: rows, total: filtered.length, page, pageSize });
});

/** GET /admin/stats — marketplace health + monthly GMV (per currency). */
adminRoutes.get("/stats", async (c) => {
  const db = firestoreFromEnv(c.env);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [activeProducts, pendingOrders, heldOrders, releasedOrders, refundRequestedOrders] =
    await Promise.all([
      db.queryCollection<Product>(collections.products, {
        filters: [{ field: "status", op: "==", value: "active" }],
      }),
      db.queryCollection<Order>(collections.orders, {
        filters: [{ field: "escrowStatus", op: "==", value: "pending_payment" }],
      }),
      db.queryCollection<Order>(collections.orders, {
        filters: [{ field: "escrowStatus", op: "==", value: "held" }],
      }),
      db.queryCollection<Order>(collections.orders, {
        filters: [{ field: "escrowStatus", op: "==", value: "released" }],
      }),
      db.queryCollection<Order>(collections.orders, {
        filters: [{ field: "escrowStatus", op: "==", value: "refund_requested" }],
      }),
    ]);

  const heldNeedAttention = heldOrders.filter((o) => needsAttentionFor(o)).length;
  const refundAttention = refundRequestedOrders.filter((o) => o.currency === "USD").length;

  const gmvThisMonth = { RWF: 0, USD: 0 };
  for (const order of [...releasedOrders, ...heldOrders]) {
    if (order.createdAt >= monthStart) {
      if (order.currency === "USD") gmvThisMonth.USD += order.totalPaid;
      else gmvThisMonth.RWF += order.totalPaid;
    }
  }

  return c.json({
    activeListings: activeProducts.length,
    ordersPendingPayment: pendingOrders.length,
    ordersHeld: heldOrders.length,
    refundAttention: refundAttention + heldNeedAttention,
    gmvThisMonth,
  });
});
