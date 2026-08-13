// Shared helpers for the bidding + direct-buy reservation flow.

import type { FirestoreClient, WithId } from "./firestore";
import { collections, type Bid, type Product } from "../models";

/** How long a reserved item stays held before reverting to active. */
export const RESERVATION_HOLD_MS = 15 * 60 * 1000;

/**
 * Check-on-read expiry: if a product is "reserved" past its hold window,
 * revert it to "active" and clear the holder. Simple logic — no cron needed.
 * Returns the (possibly updated) product.
 */
export async function refreshExpiredReservation(
  db: FirestoreClient,
  product: WithId<Product>,
): Promise<WithId<Product>> {
  if (
    product.status === "reserved" &&
    product.reservedUntil &&
    new Date(product.reservedUntil).getTime() <= Date.now()
  ) {
    return db.updateDoc<Product>(`${collections.products}/${product.id}`, {
      status: "active",
      reservedBy: null,
      reservedUntil: null,
      updatedAt: new Date().toISOString(),
    });
  }
  return product;
}

/** All currently active bids for a product. */
export async function activeBidsForProduct(
  db: FirestoreClient,
  productId: string,
): Promise<WithId<Bid>[]> {
  return db.queryCollection<Bid>(collections.bids, {
    filters: [
      { field: "productId", op: "==", value: productId },
      { field: "status", op: "==", value: "active" },
    ],
  });
}

/** Highest active bid amount, or null when there are no active bids. */
export function highestActiveBid(bids: WithId<Bid>[]): number | null {
  let highest: number | null = null;
  for (const bid of bids) {
    if (highest === null || bid.amount > highest) highest = bid.amount;
  }
  return highest;
}
