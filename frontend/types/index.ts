// Domain types shared with the Workers backend.
// Keep in sync with workers/src/models.ts and workers/src/lib/firebase-auth.ts.

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
  /** Admin flag, set manually in Firestore (no self-serve admin signup). */
  isAdmin?: boolean;
}

/** products/{productId} (API responses always include `id`) */
export interface Product {
  id: string;
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
  buyer: { uid: string; name: string; photoUrl: string | null };
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
  buyer?: { uid: string; name: string; email: string | null };
}
