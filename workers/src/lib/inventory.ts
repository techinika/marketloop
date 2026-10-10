// Inventory bookkeeping shared by order creation, payment webhooks and the
// refund/forfeit paths. Kept in one module so the two listing kinds behave
// consistently:
//   made_to_order -> a stored `currentOpenOrders` counter tracks how many slots
//                    are occupied; keeps/moves `acceptingOrders` in sync with
//                    `maxConcurrentOrders`.
//   ready_to_ship -> sold units are subtracted from `quantityAvailable` only
//                    once payment confirms, and returned on refunds.
// All writes use an optimistic-concurrency CAS (`updateDocIf`) so parallel
// webhooks/refunds can never double-count or drive stock negative.

import { firestoreFromEnv } from "./firestore";
import { collections, type Product } from "../models";
import type { Env } from "../types";

/**
 * Applies `delta` (+1 on order creation, -1 when an order settles or fails) to
 * a made-to-order product's `currentOpenOrders` counter. No-op for
 * ready-to-ship products or missing products. When the counter reaches
 * `maxConcurrentOrders` the product stops taking orders; dropping back below
 * (with room, and unless the artisan manually paused) re-opens it. Retries the
 * CAS up to 3 times so concurrent transitions don't drop updates.
 */
export async function adjustMadeToOrderSlots(
  env: Env,
  productId: string,
  delta: number,
): Promise<void> {
  if (delta === 0) return;
  const db = firestoreFromEnv(env);
  for (let attempt = 0; attempt < 3; attempt++) {
    const snap = await db.getDocWithTime<Product>(`${collections.products}/${productId}`);
    if (!snap) return;
    const product = snap.doc;
    if (product.productType === "ready_to_ship") return;

    const current = typeof product.currentOpenOrders === "number" ? product.currentOpenOrders : 0;
    const next = Math.max(0, Math.round(current + delta));
    if (next === current) return;

    const max = product.maxConcurrentOrders ?? null;
    const atCapacity = max !== null && next >= max;
    const updates: Partial<Product> = {
      currentOpenOrders: next,
      updatedAt: new Date().toISOString(),
    };
    if (delta > 0 && atCapacity && product.acceptingOrders !== false) {
      updates.acceptingOrders = false;
    } else if (
      delta < 0 &&
      product.acceptingOrders === false &&
      product.manuallyPaused !== true &&
      !atCapacity
    ) {
      updates.acceptingOrders = true;
    }

    if (await db.updateDocIf<Product>(`${collections.products}/${productId}`, updates, snap.updateTime)) {
      return;
    }
  }
}

/**
 * Removes `quantity` units from a ready-to-ship product's stock once a payment
 * confirms. Marks the product "sold_out" (never "sold") when stock hits zero
 * and clears any reservation holds. No-op for made-to-order or missing products.
 */
export async function decrementReadyToShipStock(
  env: Env,
  productId: string,
  quantity: number,
): Promise<void> {
  const db = firestoreFromEnv(env);
  for (let attempt = 0; attempt < 3; attempt++) {
    const snap = await db.getDocWithTime<Product>(`${collections.products}/${productId}`);
    if (!snap) return;
    const product = snap.doc;
    if (product.productType !== "ready_to_ship" || product.status === "removed") return;

    const qty = Math.max(1, Math.floor(quantity) || 1);
    const current = typeof product.quantityAvailable === "number" ? product.quantityAvailable : 0;
    const next = Math.max(0, current - qty);
    if (next === current) return;

    const updates: Partial<Product> = {
      quantityAvailable: next,
      updatedAt: new Date().toISOString(),
    };
    if (next === 0 && product.status !== "sold_out" && product.status !== "sold") {
      updates.status = "sold_out";
      updates.reservedBy = null;
      updates.reservedUntil = null;
    }

    if (await db.updateDocIf<Product>(`${collections.products}/${productId}`, updates, snap.updateTime)) {
      return;
    }
  }
}

/**
 * Re-adds `quantity` units of a ready-to-ship product when a paid order is
 * refunded/forfeited, and flips a "sold_out" product back to "active" so it can
 * be bought again. No-op for made-to-order or missing products.
 */
export async function restoreReadyToShipStock(
  env: Env,
  productId: string,
  quantity: number,
): Promise<void> {
  const db = firestoreFromEnv(env);
  for (let attempt = 0; attempt < 3; attempt++) {
    const snap = await db.getDocWithTime<Product>(`${collections.products}/${productId}`);
    if (!snap) return;
    const product = snap.doc;
    if (product.productType !== "ready_to_ship" || product.status === "removed") return;

    const qty = Math.max(1, Math.floor(quantity) || 1);
    const current = typeof product.quantityAvailable === "number" ? product.quantityAvailable : 0;
    const next = current + qty;
    const updates: Partial<Product> = {
      quantityAvailable: next,
      updatedAt: new Date().toISOString(),
    };
    if (product.status === "sold_out" || product.status === "sold") {
      updates.status = "active";
      updates.reservedBy = null;
      updates.reservedUntil = null;
    }

    if (await db.updateDocIf<Product>(`${collections.products}/${productId}`, updates, snap.updateTime)) {
      return;
    }
  }
}