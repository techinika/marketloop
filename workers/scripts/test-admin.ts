// End-to-end tests for the admin panel, in-app notifications, and the user
// sales/buying dashboard data endpoints.
//
// Same harness as test-orders.ts: real Hono app, mock JWKS + minted RS256
// tokens, in-memory Firestore REST mock, mock Paypack/Pesapal HTTP servers.
//
// Run with: npm run test:admin

import { createServer } from "node:http";

import app from "../src/index";
import { FirestoreClient, type FirestoreDocument, type FirestoreField } from "../src/lib/firestore";
import { processExpiredOrders } from "../src/lib/escrow";
import { collections, type Bid, type Notification, type Order, type Product, type User } from "../src/models";

const PROJECT_ID = "marketloop-rw";
const JWKS_PORT = 8830;
const JWKS_URL = `http://127.0.0.1:${JWKS_PORT}/jwks`;
const KID = "test-kid-admin";
const API_URL = "http://firestore.local/v1";
const TIME = "2026-08-13T00:00:00Z";

const PAYPACK_BASE = "http://paypack.local";
const PESAPAL_BASE = "http://pesapal.local";
const WEBHOOK_SECRET = "webhook-secret";

const encoder = new TextEncoder();

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type TestKey = Parameters<typeof crypto.subtle.sign>[1];

async function mintToken(payload: Record<string, unknown>, key: TestKey): Promise<string> {
  const header = { alg: "RS256", kid: KID, typ: "JWT" };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    key,
    encoder.encode(unsigned),
  );
  return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function hmacBase64(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ---- In-memory Firestore REST mock (same as test-orders.ts) -------------------

interface StoredDoc {
  fields: Record<string, FirestoreField>;
  createTime: string;
  updateTime: string;
}

const store = new Map<string, StoredDoc>();
let autoCounter = 0;

function docName(path: string): string {
  return `projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
}

function docJson(path: string, doc: StoredDoc): FirestoreDocument {
  return { name: docName(path), fields: doc.fields, createTime: doc.createTime, updateTime: doc.updateTime };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function decodeValue(field: FirestoreField): unknown {
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.integerValue !== undefined) return Number(field.integerValue);
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.nullValue !== undefined) return null;
  if (field.timestampValue !== undefined) return field.timestampValue;
  if (field.arrayValue !== undefined) return field.arrayValue.values.map(decodeValue);
  if (field.mapValue !== undefined) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(field.mapValue.fields)) out[key] = decodeValue(value);
    return out;
  }
  return undefined;
}

function firestoreMock(input: Parameters<typeof fetch>[0], init?: RequestInit): Response {
  const url = new URL(String(input));
  const segments = url.pathname.split("/").filter(Boolean);
  const documentsIdx = segments.indexOf("documents");
  const rest = segments.slice(documentsIdx + 1).join("/");
  const method = init?.method ?? "GET";
  const body = init?.body
    ? (JSON.parse(String(init?.body)) as {
        fields?: Record<string, FirestoreField>;
        name?: string;
        structuredQuery?: {
          from: Array<{ collectionId: string }>;
          where?: {
            fieldFilter?: unknown;
            compositeFilter?: { filters: Array<{ fieldFilter: { field: { fieldPath: string }; op: string; value: FirestoreField } }> };
          };
          orderBy?: Array<{ field: { fieldPath: string }; direction: string }>;
          limit?: number;
          offset?: number;
        };
      })
    : null;

  if (method === "POST" && rest.endsWith(":runQuery")) {
    const collectionId = rest.slice(0, -":runQuery".length);
    const q = body?.structuredQuery;
    const filters: Array<{ fieldPath: string; op: string; value: FirestoreField }> = [];
    if (q?.where) {
      if ("fieldFilter" in q.where && q.where.fieldFilter) {
        const ff = q.where.fieldFilter as { field: { fieldPath: string }; op: string; value: FirestoreField };
        filters.push({ fieldPath: ff.field.fieldPath, op: ff.op, value: ff.value });
      }
      if ("compositeFilter" in q.where && q.where.compositeFilter) {
        for (const f of q.where.compositeFilter.filters) {
          filters.push({ fieldPath: f.fieldFilter.field.fieldPath, op: f.fieldFilter.op, value: f.fieldFilter.value });
        }
      }
    }
    let entries = [...store.entries()].filter(([key]) => key.startsWith(`${collectionId}/`));
    for (const { fieldPath, op, value } of filters) {
      const want = decodeValue(value);
      entries = entries.filter(([, doc]) => {
        const got = decodeValue(doc.fields[fieldPath]!);
        switch (op) {
          case "LESS_THAN":
            return (got as number) < (want as number);
          case "LESS_THAN_OR_EQUAL":
            return (got as number) <= (want as number);
          case "GREATER_THAN":
            return (got as number) > (want as number);
          case "GREATER_THAN_OR_EQUAL":
            return (got as number) >= (want as number);
          default:
            return JSON.stringify(got) === JSON.stringify(want);
        }
      });
    }
    if (q?.orderBy?.length) {
      const { field: { fieldPath }, direction } = q.orderBy[0]!;
      const factor = direction === "DESCENDING" ? -1 : 1;
      entries.sort(([, a], [, b]) => {
        const va = decodeValue(a.fields[fieldPath]!);
        const vb = decodeValue(b.fields[fieldPath]!);
        return (va! > vb! ? 1 : va! < vb! ? -1 : 0) * factor;
      });
    }
    if (q?.offset) entries = entries.slice(q.offset);
    if (q?.limit) entries = entries.slice(0, q.limit);
    return jsonResponse(entries.map(([path, doc]) => ({ document: docJson(path, doc), readTime: TIME })));
  }

  if (method === "POST" && !rest.includes("/")) {
    const documentId = url.searchParams.get("documentId") ?? `auto-${++autoCounter}`;
    const path = `${rest}/${documentId}`;
    if (store.has(path)) return jsonResponse({ error: "already exists" }, 409);
    store.set(path, { fields: body?.fields ?? {}, createTime: TIME, updateTime: TIME });
    return jsonResponse(docJson(path, store.get(path)!));
  }

  if (method === "GET") {
    const doc = store.get(rest);
    if (!doc) return jsonResponse({ error: { code: 404, message: "Document not found.", status: "NOT_FOUND" } }, 404);
    return jsonResponse(docJson(rest, doc));
  }

  if (method === "PATCH") {
    const doc = store.get(rest);
    if (!doc) return jsonResponse({ error: { code: 404, message: "Document not found.", status: "NOT_FOUND" } }, 404);
    doc.fields = { ...doc.fields, ...(body?.fields ?? {}) };
    doc.updateTime = TIME;
    return jsonResponse(docJson(rest, doc));
  }

  return jsonResponse({ error: "unsupported" }, 400);
}

// ---- Mock Paypack server -----------------------------------------------------

function paypackMock(input: Parameters<typeof fetch>[0], init?: RequestInit): Response {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

  if (method === "POST" && url.pathname === "/auth/agents/authorize") {
    return jsonResponse({ access: "access-1", refresh: "refresh-1", expires: 900 });
  }
  if (method === "POST" && (url.pathname === "/transactions/cashin" || url.pathname === "/transactions/cashout")) {
    const kind = url.pathname === "/transactions/cashin" ? "CASHIN" : "CASHOUT";
    const idem = (init?.headers instanceof Headers ? init.headers.get("Idempotency-Key") : null) ?? "none";
    return jsonResponse({ id: `tx-${idem}`, ref: `${kind.toLowerCase()}-${idem}`, status: "PENDING", kind });
  }
  return jsonResponse({ error: "unknown route" }, 404);
}

// ---- Mock Pesapal server -----------------------------------------------------

let pesapalStatusByTracking = new Map<string, number>();
let pesapalSubmissionCount = 0;

function pesapalMock(input: Parameters<typeof fetch>[0], init?: RequestInit): Response {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

  if (method === "POST" && url.pathname === "/api/Auth/RequestToken") {
    return jsonResponse({ token: "Bearer pesapal-jwt-1", expiry_date: new Date(Date.now() + 3600_000).toISOString() });
  }
  if (method === "POST" && url.pathname === "/api/URLSetup/RegisterIPN") {
    return jsonResponse({ ipn_id: "ipn-1", url: body.url, created_date: new Date().toISOString() });
  }
  if (method === "POST" && url.pathname === "/api/Transactions/SubmitOrderRequest") {
    pesapalSubmissionCount++;
    const trackingId = `tracking-${pesapalSubmissionCount}`;
    return jsonResponse({
      order_tracking_id: trackingId,
      redirect_url: `https://pay.pesapal.com/payment/${trackingId}`,
      merchant_reference: body.id,
    });
  }
  if (method === "GET" && url.pathname === "/api/Transactions/GetTransactionStatus") {
    const trackingId = url.searchParams.get("orderTrackingId") ?? "";
    return jsonResponse({
      status_code: pesapalStatusByTracking.get(trackingId) ?? 1,
      payment_status_description: "Completed",
      merchant_reference: "order-ref",
    });
  }
  if (method === "POST" && url.pathname === "/api/Refund/RefundRequest") {
    return jsonResponse({ refund_id: "refund-1", refund_status: "INITIATED" });
  }
  return jsonResponse({ error: "unknown route" }, 404);
}

// ---- R2 binding stub ----------------------------------------------------------

const fakeImages: R2Bucket = {
  get: async () => null,
} as unknown as R2Bucket;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function bearer(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function json(token: string, payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function authedPost(token: string): RequestInit {
  return { method: "POST", headers: { Authorization: `Bearer ${token}` } };
}

async function paypackWebhook(payload: unknown): Promise<Response> {
  const raw = JSON.stringify(payload);
  const sig = await hmacBase64(raw, WEBHOOK_SECRET);
  return app.request(
    "/webhooks/paypack",
    { method: "POST", headers: { "Content-Type": "application/json", "X-Paypack-Signature": sig }, body: raw },
    env,
  );
}

async function createProduct(
  token: string,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<string> {
  const res = await app.request(
    "/products",
    json(token, {
      title: "Admin test item",
      description: "An item used to test the admin panel and notifications.",
      category: "Electronics",
      priceAmount: 50000,
      priceCurrency: "RWF",
      isNegotiable: false,
      isBiddingEnabled: false,
      conditionNote: "like new",
      images: ["uploads/seller-1/img.jpg"],
      videoUrl: null,
      deliveryFee: 0,
      deliveryFeePayer: "seller",
      ...overrides,
    }),
    env,
  );
  assert(res.status === 201, `createProduct failed with ${res.status}`);
  const body = (await res.json()) as { product: Product & { id: string } };
  return body.product.id;
}

async function reserve(token: string, productId: string): Promise<void> {
  const res = await app.request(`/products/${productId}/reserve`, authedPost(token), env);
  assert(res.status === 200, `reserve failed with ${res.status}`);
}

async function createRwfOrder(token: string, productId: string): Promise<Order & { id: string }> {
  const res = await app.request("/orders", json(token, { productId, phoneNumber: "0788123456" }), env);
  assert(res.status === 200, `POST /orders failed with ${res.status}`);
  const body = (await res.json()) as { order: Order & { id: string } };
  return body.order;
}

async function getNotifications(token: string): Promise<Array<Notification & { id: string }>> {
  const res = await app.request("/notifications", bearer(token), env);
  assert(res.status === 200, `GET /notifications failed with ${res.status}`);
  const body = (await res.json()) as { notifications: Array<Notification & { id: string }> };
  return body.notifications;
}

let env: Record<string, unknown>;
let adminToken: string;
let sellerToken: string;
let buyerToken: string;
let buyer2Token: string;
let db: FirestoreClient;

async function main(): Promise<void> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "firestore.local") return Promise.resolve(firestoreMock(input, init));
    if (url.hostname === "paypack.local") return Promise.resolve(paypackMock(input, init));
    if (url.hostname === "pesapal.local") return Promise.resolve(pesapalMock(input, init));
    return realFetch(input, init);
  }) as typeof fetch;

  const { publicKey, privateKey } = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as { publicKey: TestKey; privateKey: TestKey };
  const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
  const jwks = { keys: [{ ...publicJwk, kid: KID, alg: "RS256", use: "sig" }] };

  const jwksServer = createServer((req, res) => {
    if (req.url?.startsWith("/jwks")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(jwks));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => jwksServer.listen(JWKS_PORT, "127.0.0.1", resolve));

  try {
    env = {
      IMAGES: fakeImages,
      R2_ACCOUNT_ID: "test-account",
      R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
      R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      R2_BUCKET_NAME: "marketloop-images",
      FIREBASE_PROJECT_ID: PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: "test@example.com",
      FIREBASE_PRIVATE_KEY: "test-key",
      FIRESTORE_API_URL: API_URL,
      FIRESTORE_ACCESS_TOKEN: "test-access-token",
      FIREBASE_JWKS_URL: JWKS_URL,
      PAYPACK_CLIENT_ID: "client-id",
      PAYPACK_CLIENT_SECRET: "client-secret",
      PAYPACK_BASE_URL: PAYPACK_BASE,
      PAYPACK_ENVIRONMENT: "production",
      PAYPACK_WEBHOOK_SECRET: WEBHOOK_SECRET,
      PESAPAL_CONSUMER_KEY: "consumer-key",
      PESAPAL_CONSUMER_SECRET: "consumer-secret",
      PESAPAL_BASE_URL: PESAPAL_BASE,
      FRONTEND_URL: "http://localhost:3000",
    };

    const now = Math.floor(Date.now() / 1000);
    const claims = {
      aud: PROJECT_ID,
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      auth_time: now - 60,
      iat: now - 60,
      exp: now + 3600,
    };
    adminToken = await mintToken({ ...claims, sub: "admin-1", name: "Admin", email: "admin@example.com" }, privateKey);
    sellerToken = await mintToken({ ...claims, sub: "seller-1", name: "Seller", email: "seller@example.com" }, privateKey);
    buyerToken = await mintToken({ ...claims, sub: "buyer-1", name: "Buyer One", email: "buyer1@example.com" }, privateKey);
    buyer2Token = await mintToken({ ...claims, sub: "buyer-2", name: "Buyer Two", email: "buyer2@example.com" }, privateKey);

    db = new FirestoreClient({
      projectId: PROJECT_ID,
      clientEmail: "test@example.com",
      privateKey: "test-key",
      apiUrl: API_URL,
      accessTokenProvider: async () => "test-access-token",
    });
    for (const u of [
      { uid: "admin-1", name: "Admin", email: "admin@example.com", photoUrl: null, isAdmin: true },
      { uid: "seller-1", name: "Seller", email: "seller@example.com", photoUrl: null },
      { uid: "buyer-1", name: "Buyer One", email: "buyer1@example.com", photoUrl: null },
      { uid: "buyer-2", name: "Buyer Two", email: "buyer2@example.com", photoUrl: null },
    ]) {
      await db.createDoc<User>(collections.users, u.uid, {
        uid: u.uid,
        name: u.name,
        email: u.email,
        photoUrl: u.photoUrl,
        phone: u.uid === "buyer-1" ? "0788123456" : null,
        walletBalance: 0,
        createdAt: new Date(now * 1000).toISOString(),
        rating: null,
        isAdmin: u.isAdmin === true,
      });
    }

    // ---- 1. /auth/me surfaces isAdmin; admin gate 401/403/200 ----------------
    const meAdmin = await app.request("/auth/me", bearer(adminToken), env);
    assert(meAdmin.status === 200, `GET /auth/me (admin) failed with ${meAdmin.status}`);
    assert(((await meAdmin.json()) as { user: { isAdmin: boolean } }).user.isAdmin === true, "admin sees isAdmin: true");

    const meSeller = await app.request("/auth/me", bearer(sellerToken), env);
    assert(((await meSeller.json()) as { user: { isAdmin: boolean } }).user.isAdmin === false, "seller sees isAdmin: false");

    const noToken = await app.request("/admin/stats", {}, env);
    assert(noToken.status === 401, `admin without token should be 401, got ${noToken.status}`);
    const nonAdmin = await app.request("/admin/stats", bearer(sellerToken), env);
    assert(nonAdmin.status === 403, `non-admin should be 403, got ${nonAdmin.status}`);
    const okStats = await app.request("/admin/stats", bearer(adminToken), env);
    assert(okStats.status === 200, `admin stats should be 200, got ${okStats.status}`);

    // ---- 2. Bid notifications: placed -> seller; accepted -> winner + others ---
    const productA = await createProduct(sellerToken, {
      title: "Bid notification item",
      isBiddingEnabled: true,
      priceAmount: 50000,
      deliveryFee: 5000,
      deliveryFeePayer: "buyer",
    });
    const place1 = await app.request(`/products/${productA}/bids`, json(buyerToken, { amount: 45000, currency: "RWF" }), env);
    assert(place1.status === 201, `buyer-1 bid failed with ${place1.status}`);
    const place2 = await app.request(`/products/${productA}/bids`, json(buyer2Token, { amount: 44000, currency: "RWF" }), env);
    assert(place2.status === 201, `buyer-2 bid failed with ${place2.status}`);

    const sellerNotes = await getNotifications(sellerToken);
    assert(
      sellerNotes.filter((n) => n.type === "bid_placed").length === 2,
      `seller should have 2 bid_placed notifications, got ${sellerNotes.length}`,
    );

    const bid1 = ((await place1.json()) as { bid: Bid & { id: string } }).bid;
    const acceptRes = await app.request(`/bids/${bid1.id}/accept`, authedPost(sellerToken), env);
    assert(acceptRes.status === 200, `accept bid failed with ${acceptRes.status}`);

    const winnerNotes = await getNotifications(buyerToken);
    assert(winnerNotes.some((n) => n.type === "bid_accepted"), "winner gets bid_accepted");
    const loserNotes = await getNotifications(buyer2Token);
    assert(loserNotes.some((n) => n.type === "bid_not_selected"), "other bidder gets bid_not_selected");

    // ---- 3. Payment held notifications (webhook) + release -------------------
    const orderA = await createRwfOrder(buyerToken, productA);
    const heldAck = await paypackWebhook({ ref: orderA.paymentReference, status: "successful", kind: "CASHIN" });
    assert(heldAck.status === 200, `paypack webhook failed with ${heldAck.status}`);

    const sellerHeld = await getNotifications(sellerToken);
    const buyerHeld = await getNotifications(buyerToken);
    assert(sellerHeld.some((n) => n.type === "payment_held" && n.relatedOrderId === orderA.id), "seller notified payment held");
    assert(buyerHeld.some((n) => n.type === "payment_held" && n.relatedOrderId === orderA.id), "buyer notified payment held");

    const confirmBuyer = await app.request(`/orders/${orderA.id}/confirm-delivery`, authedPost(buyerToken), env);
    assert(confirmBuyer.status === 200, `buyer confirm failed with ${confirmBuyer.status}`);
    const confirmSeller = await app.request(`/orders/${orderA.id}/confirm-delivery`, authedPost(sellerToken), env);
    assert(confirmSeller.status === 200, `seller confirm failed with ${confirmSeller.status}`);
    const sellerReleased = await getNotifications(sellerToken);
    assert(
      sellerReleased.some((n) => n.type === "escrow_released" && n.relatedOrderId === orderA.id),
      "seller notified funds released",
    );

    // ---- 4. Admin order list, detail, users, stats ---------------------------
    const adminOrders = await app.request("/admin/orders", bearer(adminToken), env);
    assert(adminOrders.status === 200, `GET /admin/orders failed with ${adminOrders.status}`);
    const adminOrdersBody = (await adminOrders.json()) as {
      orders: Array<{ id: string; escrowStatus: string; buyer: { name: string; email: string }; seller: { name: string; email: string }; product: { title: string }; needsAttention: boolean; totalPaid: number }>;
    };
    assert(adminOrdersBody.orders.length === 1, "one order in admin list");
    const rowA = adminOrdersBody.orders[0]!;
    assert(rowA.escrowStatus === "released", "released order listed");
    assert(rowA.buyer.name === "Buyer One" && rowA.buyer.email === "buyer1@example.com", "buyer name+email included");
    assert(rowA.seller.name === "Seller" && rowA.seller.email === "seller@example.com", "seller name+email included");
    assert(rowA.product.title === "Bid notification item", "product title included");
    assert(rowA.totalPaid === 50000, "totalPaid included");

    const detailRes = await app.request(`/admin/orders/${orderA.id}`, bearer(adminToken), env);
    assert(detailRes.status === 200, `GET /admin/orders/:id failed with ${detailRes.status}`);
    const detail = (await detailRes.json()) as { order: Order & { id: string }; transactions: Array<{ type: string; amount: number }> };
    assert(detail.order.id === orderA.id, "detail returns order");
    assert(detail.transactions.length === 1 && detail.transactions[0]!.type === "credit", "linked credit transaction returned");

    const usersRes = await app.request("/admin/users", bearer(adminToken), env);
    assert(usersRes.status === 200, `GET /admin/users failed with ${usersRes.status}`);
    const usersBody = (await usersRes.json()) as {
      users: Array<{ uid: string; isAdmin: boolean; productCount: number; orderCount: number; walletBalance: number }>;
      total: number;
    };
    assert(usersBody.total === 4, "all four users listed");
    const sellerRow = usersBody.users.find((u) => u.uid === "seller-1")!;
    assert(sellerRow.productCount === 1, "seller product count (productA at this point)");
    assert(sellerRow.orderCount === 0, "seller order count (orders where buyerId = seller)");
    const adminRow = usersBody.users.find((u) => u.uid === "admin-1")!;
    assert(adminRow.isAdmin === true, "admin flagged in user list");

    const searchRes = await app.request("/admin/users?search=buyer", bearer(adminToken), env);
    const searchBody = (await searchRes.json()) as { users: Array<{ uid: string }>; total: number };
    assert(searchBody.total === 2, "search matches buyer-1 and buyer-2");

    const statsNowRes = await app.request("/admin/stats", bearer(adminToken), env);
    const statsBody = (await statsNowRes.json()) as { activeListings: number; ordersPendingPayment: number; ordersHeld: number; refundAttention: number; gmvThisMonth: { RWF: number; USD: number } };
    assert(statsBody.activeListings === 0, "no active listings (productA sold)");
    assert(statsBody.ordersPendingPayment === 0, "no pending orders");
    assert(statsBody.ordersHeld === 0, "no held orders (released)");
    assert(statsBody.refundAttention === 0, "nothing needs refund attention yet");
    assert(statsBody.gmvThisMonth.RWF === 50000, "monthly GMV includes released order");

    // ---- 5. Notification read semantics --------------------------------------
    const unread = await getNotifications(buyerToken);
    const target = unread[0]!;
    const readRes = await app.request(`/notifications/${target.id}/read`, authedPost(buyerToken), env);
    assert(readRes.status === 200, `mark read failed with ${readRes.status}`);
    const afterRead = await getNotifications(buyerToken);
    assert(afterRead.find((n) => n.id === target.id)!.isRead === true, "notification marked read");

    const stealRead = await app.request(`/notifications/${target.id}/read`, authedPost(buyer2Token), env);
    assert(stealRead.status === 403, `marking someone else's notification read should be 403, got ${stealRead.status}`);

    const readAllRes = await app.request("/notifications/read-all", authedPost(buyerToken), env);
    assert(readAllRes.status === 200, `read-all failed with ${readAllRes.status}`);
    const afterReadAll = await getNotifications(buyerToken);
    assert(afterReadAll.every((n) => n.isRead), "read-all marks everything read");

    // ---- 6. Auto-refund -> buyer notified; admin mark-refunded ----------------
    const productG = await createProduct(sellerToken, {
      title: "Auto refund USD",
      priceAmount: 300,
      priceCurrency: "USD",
    });
    await reserve(buyerToken, productG);
    const createG = await app.request("/orders", json(buyerToken, { productId: productG }), env);
    const orderG = ((await createG.json()) as { order: Order & { id: string } }).order;
    const trackingG = orderG.paymentReference;
    pesapalStatusByTracking.set(trackingG, 1);
    await app.request("/webhooks/pesapal-ipn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderTrackingId: trackingG }) }, env);
    await db.updateDoc<Order>(`${collections.orders}/${orderG.id}`, {
      deliveryDeadline: new Date(Date.now() - 1000).toISOString(),
    });
    const cronResult = await processExpiredOrders(env as never);
    assert(cronResult.requested === 1, "pesapal refund requested by cron");

    const buyerAfterRefund = await getNotifications(buyerToken);
    assert(
      buyerAfterRefund.some((n) => n.type === "order_refunded" && n.relatedOrderId === orderG.id),
      "buyer notified about refund",
    );

    // ---- 7. Needs-attention ordering + status filter --------------------------
    const productI = await createProduct(sellerToken, { title: "Approaching deadline", priceAmount: 10000 });
    await reserve(buyerToken, productI);
    const orderI = await createRwfOrder(buyerToken, productI);
    await paypackWebhook({ ref: orderI.paymentReference, status: "successful", kind: "CASHIN" });
    await db.updateDoc<Order>(`${collections.orders}/${orderI.id}`, {
      deliveryDeadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const attentionRes = await app.request("/admin/orders", bearer(adminToken), env);
    const attentionBody = (await attentionRes.json()) as { orders: Array<{ id: string; needsAttention: boolean; escrowStatus: string }> };
    const attentionIds = attentionBody.orders.map((o) => o.id);
    assert(attentionBody.orders[0]!.needsAttention === true, "needs-attention order pinned first");
    const flagged = attentionBody.orders.filter((o) => o.needsAttention).map((o) => o.id);
    assert(flagged.includes(orderG.id) && flagged.includes(orderI.id), "refund_requested + approaching-deadline orders flagged");
    assert(flagged.length === 2, "exactly two orders need attention");
    assert(attentionIds[0] === orderG.id || attentionIds[0] === orderI.id, "first row is one of the flagged orders");
    const unflagged = attentionBody.orders.find((o) => o.id === orderA.id)!;
    assert(unflagged.needsAttention === false, "released order not flagged");

    const filterRes = await app.request("/admin/orders?status=held", bearer(adminToken), env);
    const filterBody = (await filterRes.json()) as { orders: Array<{ id: string }> };
    assert(filterBody.orders.length === 1 && filterBody.orders[0]!.id === orderI.id, "status filter works");

    // ---- 8. Admin mark-refunded ----------------------------------------------
    const markOnWrong = await app.request(`/admin/orders/${orderA.id}/mark-refunded`, json(adminToken, { adminNote: "nope" }), env);
    assert(markOnWrong.status === 409, `mark-refunded on non-refund_requested should be 409, got ${markOnWrong.status}`);

    const markRes = await app.request(`/admin/orders/${orderG.id}/mark-refunded`, json(adminToken, { adminNote: "Confirmed on Pesapal dashboard" }), env);
    assert(markRes.status === 200, `mark-refunded failed with ${markRes.status}`);
    const marked = (await markRes.json()) as { order: Order & { id: string } };
    assert(marked.order.escrowStatus === "refunded", "order marked refunded");
    assert(marked.order.adminAction === "mark-refunded" && marked.order.adminUid === "admin-1", "admin audit trail stored");

    const refundTxs = await db.queryCollection<{ type: string }>(collections.walletTransactions, {
      filters: [
        { field: "orderId", op: "==", value: orderG.id },
        { field: "type", op: "==", value: "refund" },
      ],
    });
    assert(refundTxs.length === 1, "no duplicate refund transaction on admin confirmation");

    // ---- 9. Force-release (admin-only, requires adminNote) --------------------
    const noNote = await app.request(`/admin/orders/${orderI.id}/force-release`, json(adminToken, {}), env);
    assert(noNote.status === 400, `force-release without adminNote should be 400, got ${noNote.status}`);
    const nonAdminRelease = await app.request(`/admin/orders/${orderI.id}/force-release`, json(sellerToken, { adminNote: "I'm not admin" }), env);
    assert(nonAdminRelease.status === 403, `non-admin force-release should be 403, got ${nonAdminRelease.status}`);

    const forceRes = await app.request(`/admin/orders/${orderI.id}/force-release`, json(adminToken, { adminNote: "Admin verified delivery by phone" }), env);
    assert(forceRes.status === 200, `force-release failed with ${forceRes.status}`);
    const forced = (await forceRes.json()) as { order: Order & { id: string } };
    assert(forced.order.escrowStatus === "released", "force-release sets released");
    assert(forced.order.adminNote === "Admin verified delivery by phone", "adminNote stored");

    const sellerWallet = await app.request("/wallet", bearer(sellerToken), env);
    const walletBody = (await sellerWallet.json()) as { walletBalance: number; transactions: Array<{ orderId: string | null; amount: number; type: string }> };
    assert(walletBody.walletBalance === 45000 + 10000, "seller credited for both releases (45000 agreed + 10000 force)");

    const forceOnReleased = await app.request(`/admin/orders/${orderA.id}/force-release`, json(adminToken, { adminNote: "again" }), env);
    assert(forceOnReleased.status === 409, `force-release on released order should be 409, got ${forceOnReleased.status}`);

    // ---- 10. /orders/mine + /orders/sales (dashboard data) --------------------
    const mineRes = await app.request("/orders/mine", bearer(buyerToken), env);
    assert(mineRes.status === 200, `GET /orders/mine failed with ${mineRes.status}`);
    const mineBody = (await mineRes.json()) as { orders: Array<{ id: string; escrowStatus: string; product: { title: string } | null }> };
    assert(mineBody.orders.length === 3, "buyer sees all their orders");
    assert(mineBody.orders.some((o) => o.id === orderA.id), "mine includes released order");
    assert(mineBody.orders[0]!.product !== null, "mine includes product summary");

    const salesRes = await app.request("/orders/sales", bearer(sellerToken), env);
    assert(salesRes.status === 200, `GET /orders/sales failed with ${salesRes.status}`);
    const salesBody = (await salesRes.json()) as { orders: Array<{ id: string; buyer: { name: string; email: string } }> };
    assert(salesBody.orders.length === 3, "seller sees all their sales");
    assert(salesBody.orders.some((o) => o.buyer.name === "Buyer One"), "sales include buyer info");

    console.log(
      "ADMIN/NOTIFICATION TESTS PASSED (isAdmin gate, /auth/me, notifications + read semantics, admin orders/users/stats, mark-refunded, force-release, needs-attention ordering, /orders/mine + /orders/sales)",
    );
  } finally {
    jwksServer.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
