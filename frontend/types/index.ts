// Domain types shared with the Workers backend.
// Keep in sync with workers/src/models.ts and workers/src/lib/firebase-auth.ts.

export type Currency = "USD" | "RWF";
export type ProductStatus = "active" | "sold" | "reserved" | "removed";
export type DeliveryFeePayer = "seller" | "buyer";
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

/** Public seller info returned by GET /products/:id. */
export interface SellerSummary {
  uid: string;
  name: string;
  photoUrl: string | null;
  avgRating: number | null;
  ratingCount: number;
  /** Identity verification status (informational; never gates selling). */
  verificationStatus?: VerificationStatus;
  /** True once the seller confirmed a phone number by OTP. */
  phoneVerified?: boolean;
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
  seller: SellerSummary;
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
}

/** Explore feed ordering (GET /products?sortBy=). */
export type FeedSortBy = "newest" | "price_asc" | "price_desc";

/** products/{productId} (API responses always include `id`) */
export interface Product {
  id: string;
  sellerId: string;
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
  status: ProductStatus;
  reservedBy: string | null;
  reservedUntil: string | null;
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

/** A row in the seller's bid list (GET /products/:id/bids/all). */
export interface SellerBidRow {
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
  senderRole: "buyer" | "seller";
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
  callerRole: "buyer" | "seller";
  allowed: boolean;
  reason: string | null;
  callerConfirmed: boolean;
  otherConfirmed: boolean;
  callerFeedbackSubmitted: boolean;
  hasDispute: boolean;
  escrowStatus: EscrowStatus;
}

/** orders/{orderId} */
export interface Order {
  id: string;
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
  buyerFeedback?: Feedback | null;
  sellerFeedback?: Feedback | null;
  /** True when either party reported a problem; funds stay locked until admin review. */
  hasDispute?: boolean;
  disputeReason?: string | null;
  /** Set when payment confirms: now + 5 days. Empty until then. */
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
  seller: PartySummary;
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
  seller: { uid: string; name: string; email: string | null };
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
  seller: User | null;
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
