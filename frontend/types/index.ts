// Domain types shared with the Workers backend.
// Keep in sync with workers/src/models.ts and workers/src/lib/firebase-auth.ts.

export type Currency = "USD" | "RWF";
export type ProductStatus = "active" | "sold" | "reserved" | "removed" | "sold_out";

/**
 * Two listing kinds:
 * - `made_to_order` — finished after the order lands (deposit/full, production lifecycle).
 * - `ready_to_ship` — already finished; paid in full; stock tracked via quantityAvailable.
 */
export type ProductType = "made_to_order" | "ready_to_ship";
export type DeliveryFeePayer = "artisan" | "buyer";
export type BidStatus = "active" | "withdrawn" | "accepted";
export type PaymentProvider = "paypack" | "pesapal";
export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";
export type IdDocumentType = "national_id" | "passport" | "drivers_license";
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

/** Public artisan info returned by GET /products/:id. */
export interface ArtisanSummary {
  uid: string;
  name: string;
  photoUrl: string | null;
  avgRating: number | null;
  ratingCount: number;
  /** Identity verification status (informational; never gates selling). */
  verificationStatus?: VerificationStatus;
  /** True once the artisan confirmed a phone number by OTP. */
  phoneVerified?: boolean;
}

/** Public artisan storefront returned by GET /artisans/:uid. */
export interface ArtisanStorefront {
  uid: string;
  name: string;
  photoUrl: string | null;
  /** Preferred display name for the shop; falls back to `name`. */
  storeName: string | null;
  storeBio: string | null;
  storeRegion: string | null;
  specialties: string[];
  avgRating: number | null;
  ratingCount: number;
  isVerifiedSeller: boolean;
  joinedAt: string;
}

/** Response of GET /artisans/:uid. */
export interface ArtisanProfile {
  artisan: ArtisanStorefront;
  products: Product[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Response of GET /products. */
export interface ProductFeed {
  products: Product[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Response of GET /products/:id. */
export interface ProductDetail {
  product: Product;
  artisan: ArtisanSummary;
}

export interface AuthUser {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  isAdmin?: boolean;
  /** Set once the phone number was confirmed via OTP. */
  phoneVerifiedAt?: string | null;
  verificationStatus?: VerificationStatus;
  idDocumentType?: IdDocumentType | null;
  verificationNote?: string | null;
}

/** Response of GET /verifications/me. */
export interface VerificationState {
  phoneVerifiedAt: string | null;
  verificationStatus: VerificationStatus;
  idDocumentType: IdDocumentType | null;
  verificationSubmittedAt: string | null;
  verificationNote: string | null;
}

/** Row in GET /admin/verifications/pending. */
export interface AdminVerificationRow {
  uid: string;
  name: string;
  email: string;
  phone: string | null;
  photoUrl: string | null;
  phoneVerified: boolean;
  idDocumentType: IdDocumentType | null;
  verificationSubmittedAt: string | null;
  createdAt: string;
  documentUrl: string | null;
}

/** Response of GET /admin/verifications/pending. */
export interface AdminVerificationList {
  verifications: AdminVerificationRow[];
}

/** users/{uid} */
export interface User {
  uid: string;
  name: string;
  email: string;
  photoUrl: string | null;
  phone: string | null;
  walletBalance: number;
  createdAt: string;
  rating: number | null;
  /** Average rating received across transactions (1-5). Null until first rating. */
  avgRating?: number | null;
  /** Number of ratings received across transactions. */
  ratingCount?: number;
  /** Admin flag, set manually in Firestore (no self-serve admin signup). */
  isAdmin?: boolean;
  /** Public storefront name (artisan profile); falls back to `name` when absent. */
  storeName?: string | null;
  /** Short bio shown on the artisan storefront. */
  storeBio?: string | null;
  /** Region/province the artisan works from. */
  storeRegion?: string | null;
  /** Craft specialties (e.g. ["Basketry", "Batik"]). */
  specialties?: string[];
}

/** Explore feed ordering (GET /products?sortBy=). */
export type FeedSortBy = "newest" | "price_asc" | "price_desc";

/** products/{productId} (API responses always include `id`) */
export interface Product {
  id: string;
  artisanId: string;
  title: string;
  description: string;
  category: string;
  /** Lowercased title words used for keyword search; may be absent on old listings. */
  titleKeywords?: string[];
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
  productType?: ProductType;
  /** Free-form discovery tags (e.g. "sisal", "wedding"). */
  tags?: string[];
  /** Materials used in the piece (e.g. "Banana Fiber"). */
  materials?: string[];
  /** Region/province the piece is made in. */
  region?: string | null;
  /** Whether the artisan is currently accepting new made-to-order slots. */
  acceptingOrders?: boolean;
  /** Cap on concurrent open made-to-orders; null = unlimited. */
  maxConcurrentOrders?: number | null;
  /** Live count of open made-to-order slots, maintained by the backend. */
  currentOpenOrders?: number;
  /** True when the artisan manually paused orders; blocks auto-reopen at capacity. */
  manuallyPaused?: boolean;
  /** Units in stock (ready-to-ship); 0 => sold out. */
  quantityAvailable?: number;
  /** Artisan's estimated days to make this piece (made-to-order; 0 for ready-to-ship). */
  productionTimeDays: number;
  /** Whether the buyer can answer structured customization questions at checkout. */
  isCustomizable: boolean;
  /** Structured customization questions; only meaningful when isCustomizable. */
  customizationOptions: CustomizationOption[];
  /** Lets the buyer upload a reference image + free-text brief. */
  allowsReferenceUpload: boolean;
  status: ProductStatus;
  reservedBy: string | null;
  reservedUntil: string | null;
  /** Agreed price while the item is held (accepted offer, or list price on direct buy). */
  reservedAmount?: number;
  reservedCurrency?: Currency;
  createdAt: string;
  updatedAt: string;
}

/** bids/{bidId} (API responses always include `id`) */
export interface Bid {
  id: string;
  productId: string;
  buyerId: string;
  amount: number;
  currency: string;
  status: BidStatus;
  createdAt: string;
  updatedAt: string;
}

/** Public bid summary from GET /products/:id/bids. */
export interface BidSummary {
  bidCount: number;
  highestBid: number | null;
  currency: string;
}

/** A row in the artisan's bid list (GET /products/:id/bids/all). */
export interface ArtisanBidRow {
  id: string;
  amount: number;
  currency: string;
  createdAt: string;
  buyer: { uid: string; name: string; photoUrl: string | null; avgRating: number | null; ratingCount: number };
}

/** A row in the buyer's bid dashboard (GET /bids/mine). */
export interface MyBidRow {
  id: string;
  productId: string;
  amount: number;
  currency: string;
  status: BidStatus;
  createdAt: string;
  updatedAt: string;
  product: {
    id: string;
    title: string;
    images: string[];
    status: ProductStatus;
    priceCurrency: Currency;
    isBiddingEnabled: boolean;
  } | null;
}

/** Result of accepting a bid or reserving a product: "ready to pay". */
export interface CheckoutInfo {
  productId: string;
  buyerId: string;
  amount: number;
  currency: string;
}

/** Delivery confirmation feedback. Required from both parties before release. */
export interface Feedback {
  rating: number;
  comment: string | null;
  submittedAt: string;
}

/** messages/{messageId} — one entry in an order's chat thread. */
export interface Message {
  id: string;
  orderId: string;
  senderId: string;
  senderRole: "buyer" | "artisan";
  text: string;
  isRead: boolean;
  createdAt: string;
}

/** Response of GET /orders/:id/messages. */
export interface MessageListResponse {
  messages: Message[];
  hasMore: boolean;
  /** Cursor for older messages (createdAt of the oldest returned). */
  nextBefore: string | null;
}

/** Response of GET /orders/:id/can-confirm. */
export interface CanConfirmResponse {
  orderId: string;
  callerRole: "buyer" | "artisan";
  allowed: boolean;
  reason: string | null;
  callerConfirmed: boolean;
  otherConfirmed: boolean;
  callerFeedbackSubmitted: boolean;
  hasDispute: boolean;
  escrowStatus: EscrowStatus;
  /** Made-to-order lifecycle state (undefined on legacy orders). */
  productionStatus?: ProductionStatus;
  /** True when a deposit-plan order still owes the remaining balance. */
  finalPaymentPending?: boolean;
}

/** orders/{orderId} */
export interface Order {
  id: string;
  productId: string;
  artisanId: string;
  buyerId: string;
  /** Listing kind at purchase time; drives which settlement path applies. */
  productType?: ProductType;
  /** Units purchased (1 for made-to-order; >1 for multi-unit ready-to-ship). */
  quantity?: number;
  agreedAmount: number;
  currency: string;
  deliveryFee: number;
  /** Who covers the courier cost; used to compute the artisan's settlement at release. */
  deliveryFeePayer: DeliveryFeePayer;
  /** Total charged to the buyer = agreedAmount + deliveryFee. */
  totalPaid: number;
  paymentProvider: PaymentProvider;
  /** Paypack cashin ref, or Pesapal order_tracking_id (the up-front charge). */
  paymentReference: string;
  /** Ref/tracking id of the remaining-balance charge (deposit plan, pay-final). */
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
  /** ISO timestamp when productionStatus last changed. */
  productionStatusAt: string;
  /** The buyer's answers to the product's customizationOptions. */
  customizationResponses: CustomizationResponse[];
  /** R2 media key of the buyer's reference image, if uploaded. */
  referenceImageUrl?: string | null;
  /** Buyer's free-text description of what they want. */
  customRequestNote?: string | null;
  /** Buyer's mid-production cancellation request, if any. */
  cancellationRequest?: CancellationRequest | null;
  buyerConfirmedDelivery: boolean;
  artisanConfirmedDelivery: boolean;
  buyerFeedback?: Feedback | null;
  artisanFeedback?: Feedback | null;
  /** True when either party reported a problem; funds stay locked until admin review. */
  hasDispute?: boolean;
  disputeReason?: string | null;
  /** Set when the piece becomes ready for delivery (mark-ready / final payment): now + 5 days. Empty during production. */
  deliveryDeadline: string;
  createdAt: string;
  updatedAt: string;
}

/** Party summary returned in GET /orders/:id. */
export interface PartySummary {
  uid: string;
  name: string;
  photoUrl: string | null;
  avgRating: number | null;
  ratingCount: number;
}

/** Response of GET /orders/:id. */
export interface OrderDetail {
  order: Order;
  product: {
    id: string;
    title: string;
    images: string[];
    status: ProductStatus;
    priceCurrency: Currency;
    isBiddingEnabled: boolean;
  } | null;
  buyer: PartySummary;
  artisan: PartySummary;
}

/** Response of GET /wallet. */
export interface WalletResponse {
  walletBalance: number;
  transactions: WalletTransaction[];
}

/** walletTransactions/{txId} */
export interface WalletTransaction {
  id: string;
  userId: string;
  orderId: string | null;
  type: WalletTransactionType;
  amount: number;
  currency: string;
  createdAt: string;
}

/** notifications/{notificationId} */
export interface Notification {
  id: string;
  userId: string;
  /** Machine-readable type (bid_placed, payment_held, escrow_released, ...). */
  type: string;
  title: string;
  message: string;
  relatedOrderId: string | null;
  relatedProductId: string | null;
  isRead: boolean;
  createdAt: string;
}

/** Response of GET /notifications. */
export interface NotificationList {
  notifications: Notification[];
  page: number;
  pageSize: number;
}

/** Row in GET /admin/orders. */
export interface AdminOrderRow {
  id: string;
  escrowStatus: EscrowStatus;
  agreedAmount: number;
  totalPaid: number;
  currency: string;
  deliveryFee: number;
  deliveryFeePayer: DeliveryFeePayer;
  paymentProvider: PaymentProvider;
  paymentReference: string;
  createdAt: string;
  deliveryDeadline: string;
  buyer: { uid: string; name: string; email: string | null };
  artisan: { uid: string; name: string; email: string | null };
  product: { id: string; title: string };
  needsAttention: boolean;
  hasDispute: boolean;
  disputeReason: string | null;
}

/** Response of GET /admin/orders. */
export interface AdminOrderList {
  orders: AdminOrderRow[];
  page: number;
  pageSize: number;
}

/** Response of GET /admin/orders/:id. */
export interface AdminOrderDetail {
  order: Order;
  product: Product | null;
  buyer: User | null;
  artisan: User | null;
  transactions: WalletTransaction[];
  messages: Message[];
}

/** Row in GET /admin/users. */
export interface AdminUserRow {
  uid: string;
  name: string;
  email: string;
  photoUrl: string | null;
  phone: string | null;
  walletBalance: number;
  createdAt: string;
  isAdmin: boolean;
  productCount: number;
  orderCount: number;
}

/** Response of GET /admin/users. */
export interface AdminUserList {
  users: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Response of GET /admin/stats. */
export interface AdminStats {
  activeListings: number;
  ordersPendingPayment: number;
  ordersHeld: number;
  refundAttention: number;
  gmvThisMonth: { RWF: number; USD: number };
}

/** Row in GET /orders/mine (buying) / GET /orders/sales (selling). */
export interface DashboardOrder extends Order {
  product: {
    id: string;
    title: string;
    images: string[];
    status: ProductStatus;
    priceCurrency: Currency;
    isBiddingEnabled: boolean;
  } | null;
  /** Present on /orders/sales rows only. */
  buyer?: {
    uid: string;
    name: string;
    email: string | null;
    avgRating: number | null;
    ratingCount: number;
  };
}
