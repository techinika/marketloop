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
  "Agaseke Baskets",
  "Imigongo Art",
  "Wood Carving",
  "Jewelry & Beadwork",
  "Textiles & Batik",
  "Pottery",
  "Paintings",
  "Sculpture",
  "Other Handmade",
] as const;

export type Currency = "USD" | "RWF";

/**
 * Two listing kinds with distinct lifecycle rules:
 * - `made_to_order` — the artisan makes the piece after an order lands (deposit
 *   or full prepay, production lifecycle, per-artisan order caps).
 * - `ready_to_ship` — already finished; paid in full up front; stock is
 *   tracked with `quantityAvailable` and decremented on each paid order.
 * Immutable after creation.
 */
export type ProductType = "made_to_order" | "ready_to_ship";

export type ProductStatus = "active" | "sold" | "reserved" | "removed" | "sold_out";
export type DeliveryFeePayer = "artisan" | "buyer";
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

/** How the buyer splits payment at checkout: deposit (50% now) or full prepay. */
export type PaymentPlan = "deposit" | "full";

/**
 * Made-to-order production lifecycle. Runs alongside `escrowStatus`, which
 * still tracks where the money is (pending_payment/held/released/...).
 */
export type ProductionStatus =
  | "pending_deposit"
  | "in_production"
  | "ready_for_delivery"
  | "awaiting_final_payment"
  | "awaiting_delivery"
  | "cancelled_by_mutual_agreement"
  | "cancelled_forfeited"
  | "released"
  | "refunded";

/** A structured customization question defined by the artisan. */
export interface CustomizationOption {
  id: string;
  type: "text" | "choice" | "image_upload";
  label: string;
  required: boolean;
  /** Added to the order total when the buyer answers this option. */
  priceAdjustment: number;
  /** Allowed values, only for type "choice". */
  choices?: string[];
}

/** The buyer's answer to one customization option, stored on the order. */
export interface CustomizationResponse {
  optionId: string;
  value: string;
}

/** A buyer's mid-production cancellation request and the artisan's verdict. */
export interface CancellationRequest {
  requestedBy: "buyer";
  reason: string;
  requestedAt: string;
  artisanDecision: "pending" | "accepted" | "rejected";
  decidedAt: string | null;
}

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
  /** Public storefront name (artisan profile); falls back to `name` when absent. */
  storeName?: string | null;
  /** Short bio shown on the artisan storefront. */
  storeBio?: string | null;
  /** Region/province the artisan works from. */
  storeRegion?: string | null;
  /** Craft specialties (e.g. ["Basketry", "Batik"]). */
  specialties?: string[];
}

/** products/{productId} */
export interface Product {
  artisanId: string;
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
  /** Which listing kind this is; immutable after creation. */
  productType: ProductType;
  /** Free-form discovery tags (e.g. "sisal", "wedding"). */
  tags: string[];
  /** Materials used in the piece (e.g. "Banana Fiber"). */
  materials: string[];
  /** Region/province the piece is made in. */
  region: string | null;
  /** Whether the artisan is currently accepting new made-to-order slots. */
  acceptingOrders: boolean;
  /** Cap on concurrent open made-to-orders; null = unlimited. */
  maxConcurrentOrders: number | null;
  /** Live count of open made-to-order slots, maintained on order transitions. */
  currentOpenOrders: number;
  /** True when the artisan manually paused orders; blocks auto-reopen at capacity. */
  manuallyPaused: boolean;
  /** Units in stock (ready-to-ship); decremented on each paid order. */
  quantityAvailable: number;
  /** Artisan's estimated days to make this piece (made-to-order; 0 for ready-to-ship). */
  productionTimeDays: number;
  /** Whether the buyer can answer structured customization questions at checkout. */
  isCustomizable: boolean;
  /** Structured customization questions; only meaningful when isCustomizable. */
  customizationOptions: CustomizationOption[];
  /** Lets the buyer upload a reference image + free-text brief (independent of the structured options). */
  allowsReferenceUpload: boolean;
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
  currency: Currency;
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

/** messages/{messageId} — per-order buyer/artisan chat thread. */
export interface Message {
  orderId: string;
  senderId: string;
  senderRole: "buyer" | "artisan";
  text: string;
  isRead: boolean;
  createdAt: string;
}

/** orders/{orderId} */
export interface Order {
  productId: string;
  artisanId: string;
  buyerId: string;
  /** Listing kind at purchase time; drives which settlement path applies. */
  productType?: ProductType;
  /** Units purchased (1 for made-to-order; >1 for multi-unit ready-to-ship). */
  quantity?: number;
  agreedAmount: number;
  currency: Currency;
  deliveryFee: number;
  /** Who covers the courier cost; used to compute the artisan's settlement at release. */
  deliveryFeePayer: DeliveryFeePayer;
  /** Total charged to the buyer = agreedAmount + deliveryFee. */
  totalPaid: number;
  paymentProvider: PaymentProvider;
  /** Paypack cashin ref, or Pesapal order_tracking_id (the up-front charge). */
  paymentReference: string;
  /** Ref/tracking id of the remaining-balance charge (deposit plan, POST /orders/:id/pay-final). */
  finalPaymentReference?: string | null;
  /** MoMo number the buyer paid from (needed for RWF auto-refunds). */
  buyerPhoneNumber: string | null;
  escrowStatus: EscrowStatus;
  /** How the buyer split payment: deposit (50% now, 50% on ready) or full prepay. */
  paymentPlan: PaymentPlan;
  /** Charged up front (50% of totalPaid for "deposit", 100% for "full"). */
  depositAmount: number;
  /** Due once the artisan marks the piece ready (0 for the "full" plan). */
  finalAmount: number;
  /** True once the deposit charge confirmed (webhook/IPN). */
  depositPaid: boolean;
  /** True once the final charge confirmed (trivially true for the "full" plan). */
  finalPaid: boolean;
  /** Made-to-order lifecycle state; runs alongside escrowStatus. */
  productionStatus: ProductionStatus;
  /** ISO timestamp when productionStatus last changed (backs the non-payment timeout). */
  productionStatusAt: string;
  /** The buyer's answers to the product's customizationOptions. */
  customizationResponses: CustomizationResponse[];
  /** R2 media key of the buyer's "make it like this" reference image, if uploaded. */
  referenceImageUrl?: string | null;
  /** Buyer's free-text description of what they want. */
  customRequestNote?: string | null;
  /** Buyer's mid-production cancellation request, if any. */
  cancellationRequest?: CancellationRequest | null;
  buyerConfirmedDelivery: boolean;
  artisanConfirmedDelivery: boolean;
  /** Set when the piece becomes ready for delivery (mark-ready / final payment): now + 5 days. Empty during production. */
  deliveryDeadline: string;
  /** Rating + comment the buyer gave about the artisan once confirmed (null until then). */
  buyerFeedback?: Feedback | null;
  /** Rating + comment the artisan gave about the buyer once confirmed (null until then). */
  artisanFeedback?: Feedback | null;
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
  currency: Currency;
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
