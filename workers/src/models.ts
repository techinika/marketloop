// Domain types for the Firestore data model.
// Keep in sync with frontend/types/index.ts.

export const collections = {
  users: "users",
  products: "products",
  bids: "bids",
  orders: "orders",
  messages: "messages",
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

/** Identity-verification workflow state (informational, never gates selling). */
export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";
export type IdDocumentType = "national_id" | "passport" | "drivers_license";

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
  /** Average rating received across transactions (1-5). Null until first rating. */
  avgRating?: number | null;
  /** Number of ratings received across transactions. */
  ratingCount?: number;
  /** Admin flag, set manually in Firestore (no self-serve admin signup). */
  isAdmin?: boolean;
  /** ISO timestamp when the phone number was verified by OTP. Absent until then. */
  phoneVerifiedAt?: string | null;
  /** Which document the user uploaded for identity verification. */
  idDocumentType?: IdDocumentType | null;
  /** R2 key of the uploaded ID document (under `id-documents/{uid}/`). */
  idDocumentKey?: string | null;
  /** Identity-verification workflow state. */
  verificationStatus?: VerificationStatus;
  verificationSubmittedAt?: string | null;
  verificationReviewedAt?: string | null;
  /** Admin note set when a submission is rejected (visible to the user). */
  verificationNote?: string | null;
}

/** products/{productId} */
export interface Product {
  sellerId: string;
  title: string;
  description: string;
  category: string;
  /** Lowercased, deduped words of `title` (len >= 2) for Firestore prefix search. */
  titleKeywords: string[];
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
  /** Agreed price while the item is held (accepted offer, or list price on direct buy). */
  reservedAmount?: number | null;
  reservedCurrency?: Currency | null;
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

/** A single order-thread message. */
export interface Feedback {
  /** 1-5, how was this transaction/counterpart (not the product). */
  rating: number;
  comment: string | null;
  submittedAt: string;
}

/** messages/{messageId} — per-order buyer/seller chat thread. */
export interface Message {
  orderId: string;
  senderId: string;
  senderRole: "buyer" | "seller";
  text: string;
  isRead: boolean;
  createdAt: string;
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
  /** Rating + comment the buyer gave about the seller once confirmed (null until then). */
  buyerFeedback?: Feedback | null;
  /** Rating + comment the seller gave about the buyer once confirmed (null until then). */
  sellerFeedback?: Feedback | null;
  /** Set when either party reports the delivery as NOT satisfactory (received=false). */
  hasDispute?: boolean;
  disputeReason?: string | null;
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
