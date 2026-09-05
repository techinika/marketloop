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
      reservedAmount: null,
      reservedCurrency: null,
      updatedAt: new Date().toISOString(),
    });
  }
  return product;
}

/**
 * Atomically moves the winning bid to "accepted" and reserves the product for
 * that buyer with a single :commit write batch:
 *   1. the bid is CAS-updated active -> accepted (fails if a concurrent
 *      withdraw/accept already moved it),
 *   2. the product is CAS-updated active -> reserved for the buyer.
 * On a concurrent change (another accept got there first, the bid was
 * withdrawn, or the product was reserved elsewhere) nothing is written and a
 * retry happens against the fresh state. Returns null when the bid is no
 * longer active, or the freshly-reserved product on success.
 */
export async function acceptBidAndReserve(
  db: FirestoreClient,
  bid: WithId<Bid>,
  product: WithId<Product>,
  reservedUntil: string,
  updatedAt: string,
): Promise<WithId<Product> | null> {
  const bidSnap = await db.getDocWithTime<Bid>(`${collections.bids}/${bid.id}`);
  if (!bidSnap || bidSnap.doc.status !== "active") return null;

  const root = db.documentsRoot;
  let productSnap = await db.getDocWithTime<Product>(`${collections.products}/${product.id}`);

  for (let attempt = 0; attempt < 4; attempt++) {
    if (!productSnap || productSnap.doc.status !== "active") return null;

    const writes = [
      {
        update: {
          name: `${root}/${collections.bids}/${bid.id}`,
          fields: { status: { stringValue: "accepted" }, updatedAt: { stringValue: updatedAt } },
          currentDocument: { updateTime: bidSnap.updateTime },
        },
      },
      {
        update: {
          name: `${root}/${collections.products}/${product.id}`,
          fields: {
            status: { stringValue: "reserved" },
            reservedBy: { stringValue: bid.buyerId },
            reservedUntil: { stringValue: reservedUntil },
            reservedAmount: { integerValue: String(bid.amount) },
            reservedCurrency: { stringValue: bid.currency },
            updatedAt: { stringValue: updatedAt },
          },
          currentDocument: { updateTime: productSnap.updateTime },
        },
      },
    ];

    const ok = await db.commitWrites(writes);
    if (ok) {
      return (await db.getDoc<Product>(`${collections.products}/${product.id}`)) ?? productSnap.doc;
    }
    // A conflicting writer touched the bid or the product; re-read the product
    // and try again against the fresh state (another accept is idempotent).
    productSnap = await db.getDocWithTime<Product>(`${collections.products}/${product.id}`);
  }
  return null;
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
