// Domain types for the Firestore data model.
// Keep in sync with frontend/types/index.ts.

export const collections = {
  users: "users",
  products: "products",
  bids: "bids",
  orders: "orders",
  walletTransactions: "walletTransactions",
  platform: "platform",
  notifications: "notifications",
} as const;

export const CATEGORIES = [
  "Phones & Tablets",
  "Electronics",
  "Fashion",
  "Home & Furniture",
  "Appliances",
  "Vehicles",
  "Sports & Outdoors",
  "Books",
  "Beauty & Health",
  "Other",
] as const;

export type Currency = "USD" | "RWF";
export type ProductStatus = "active" | "sold" | "reserved" | "removed";
export type DeliveryFeePayer = "seller" | "buyer";
export type BidStatus = "active" | "withdrawn" | "accepted";
export type PaymentProvider = "paypack" | "pesapal";
export type EscrowStatus =
  | "pending_payment"
  | "held"
  | "released"
  | "refunded"
  | "refund_requested"
  | "failed";
export type WalletTransactionType = "credit" | "debit" | "refund";

/** users/{uid} */
export interface User {
  uid: string;
  name: string;
  email: string;
  photoUrl: string | null;
  phone: string | null;
  walletBalance: number;
  createdAt: string;
  updatedAt?: string;
  rating: number | null;
  /** Admin flag, set manually in Firestore (no self-serve admin signup). */
  isAdmin?: boolean;
}

/** products/{productId} */
export interface Product {
  sellerId: string;
  title: string;
  description: string;
  category: string;
  priceAmount: number;
  priceCurrency: Currency;
  isNegotiable: boolean;
  isBiddingEnabled: boolean;
  conditionNote: string;
  images: string[];
  videoUrl: string | null;
  deliveryFee: number;
  deliveryFeePayer: DeliveryFeePayer;
  status: ProductStatus;
  /** Buyer uid holding the item (set when status becomes "reserved"). */
  reservedBy?: string | null;
  /** ISO timestamp when the reservation hold expires (check-on-read reversion). */
  reservedUntil?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** bids/{bidId} */
export interface Bid {
  productId: string;
  buyerId: string;
  amount: number;
  currency: string;
  status: BidStatus;
  createdAt: string;
  updatedAt: string;
}

/** orders/{orderId} */
export interface Order {
  productId: string;
  sellerId: string;
  buyerId: string;
  agreedAmount: number;
  currency: string;
  deliveryFee: number;
  /** Who covers the courier cost; used to compute the seller's settlement at release. */
  deliveryFeePayer: DeliveryFeePayer;
  /** Total charged to the buyer = agreedAmount + deliveryFee. */
  totalPaid: number;
  paymentProvider: PaymentProvider;
  /** Paypack cashin ref, or Pesapal order_tracking_id. */
  paymentReference: string;
  /** MoMo number the buyer paid from (needed for RWF auto-refunds). */
  buyerPhoneNumber: string | null;
  escrowStatus: EscrowStatus;
  buyerConfirmedDelivery: boolean;
  sellerConfirmedDelivery: boolean;
  /** Set when payment confirms: now + 5 days. Empty until then. */
  deliveryDeadline: string;
  createdAt: string;
  updatedAt: string;
  /** Admin audit trail (mark-refunded / force-release actions). */
  adminAction?: string | null;
  adminNote?: string | null;
  adminUid?: string | null;
  adminActionAt?: string | null;
}

/** walletTransactions/{txId} */
export interface WalletTransaction {
  userId: string;
  orderId: string | null;
  type: WalletTransactionType;
  amount: number;
  currency: string;
  createdAt: string;
}

/** notifications/{notificationId} — in-app notifications per user. */
export interface Notification {
  userId: string;
  /** Machine-readable type (bid_placed, payment_held, escrow_released, ...). */
  type: string;
  title: string;
  message: string;
  relatedOrderId: string | null;
  relatedProductId: string | null;
  isRead: boolean;
  createdAt: string;
  updatedAt?: string;
}
