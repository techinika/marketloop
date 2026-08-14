// End-to-end tests for orders (escrow), payments (Paypack + Pesapal), webhooks,
// delivery-confirmation release, scheduled auto-refund, and the seller wallet.
//
// Same harness as test-bids.ts (real Hono app, mock JWKS + minted RS256 tokens,
// in-memory Firestore REST mock) plus local mock Paypack/Pesapal HTTP servers.
//
// Run with: npm run test:orders

import { createServer } from "node:http";

import app from "../src/index";
import { FirestoreClient, type FirestoreDocument, type FirestoreField } from "../src/lib/firestore";
import { processExpiredOrders } from "../src/lib/escrow";
import { collections, type Bid, type Order, type Product, type User } from "../src/models";

const PROJECT_ID = "marketloop-rw";
const JWKS_PORT = 8820;
const JWKS_URL = `http://127.0.0.1:${JWKS_PORT}/jwks`;
const KID = "test-kid-3";
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

// ---- In-memory Firestore REST mock (same as test-bids.ts) -------------------

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
        documents?: string[];
        newTransaction?: unknown;
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
    const q = body?.structuredQuery;
    const collectionId = q?.from?.[0]?.collectionId ?? rest.slice(0, -":runQuery".length);
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

  if (method === "POST" && rest.endsWith(":batchGet")) {
    const documents = (body as { documents?: string[] }).documents ?? [];
    const responses = documents.map((name) => {
      const path = name.split("/documents/")[1] ?? name;
      const doc = store.get(path);
      return doc ? { found: docJson(path, doc), readTime: TIME } : { missing: name, readTime: TIME };
    });
    return jsonResponse({ responses });
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

const paypackCashins: Array<{ idempotencyKey: string; amount: number; phoneNumber: string; environment: string }> = [];
const paypackCashouts: Array<{ idempotencyKey: string; amount: number; phoneNumber: string }> = [];
let paypackCashinShouldFail = false;
let paypackCashoutShouldFail = false;

function paypackMock(input: Parameters<typeof fetch>[0], init?: RequestInit): Response {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

  if (method === "POST" && url.pathname === "/auth/agents/authorize") {
    return jsonResponse({ access: "access-1", refresh: "refresh-1", expires: 900 });
  }
  if (method === "GET" && url.pathname.startsWith("/auth/agents/refresh/")) {
    return jsonResponse({ access: "access-2", refresh: "refresh-2", expires: 900 });
  }
  if (method === "POST" && (url.pathname === "/transactions/cashin" || url.pathname === "/transactions/cashout")) {
    const kind = url.pathname === "/transactions/cashin" ? "CASHIN" : "CASHOUT";
    const idem = (init?.headers instanceof Headers ? init.headers.get("Idempotency-Key") : null) ?? "none";
    const amount = body.amount as number;
    const phoneNumber = body.number as string;
    if (kind === "CASHIN") {
      if (paypackCashinShouldFail) return jsonResponse({ error: "provider down" }, 500);
      paypackCashins.push({ idempotencyKey: idem, amount, phoneNumber, environment: body.environment as string });
    } else {
      if (paypackCashoutShouldFail) return jsonResponse({ error: "provider down" }, 500);
      paypackCashouts.push({ idempotencyKey: idem, amount, phoneNumber });
    }
    return jsonResponse({ id: `tx-${idem}`, ref: `${kind.toLowerCase()}-${idem}`, status: "PENDING", kind });
  }
  if (method === "GET" && url.pathname.startsWith("/transactions/find/")) {
    return jsonResponse({ status: "PENDING" });
  }
  return jsonResponse({ error: "unknown route" }, 404);
}

// ---- Mock Pesapal server -----------------------------------------------------

const pesapalSubmissions: Array<{ id: string; amount: number; notificationId: string }> = [];
let pesapalIpnRegistrations = 0;
let pesapalStatusByTracking = new Map<string, number>();

function pesapalMock(input: Parameters<typeof fetch>[0], init?: RequestInit): Response {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

  if (method === "POST" && url.pathname === "/api/Auth/RequestToken") {
    return jsonResponse({ token: "Bearer pesapal-jwt-1", expiry_date: new Date(Date.now() + 3600_000).toISOString() });
  }
  if (method === "POST" && url.pathname === "/api/URLSetup/RegisterIPN") {
    pesapalIpnRegistrations++;
    return jsonResponse({ ipn_id: "ipn-1", url: body.url, created_date: new Date().toISOString() });
  }
  if (method === "POST" && url.pathname === "/api/Transactions/SubmitOrderRequest") {
    const trackingId = `tracking-${pesapalSubmissions.length + 1}`;
    pesapalSubmissions.push({
      id: body.id as string,
      amount: body.amount as number,
      notificationId: body.notification_id as string,
    });
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

// In-memory KV for phone-verification OTP codes.
const kvStore = new Map<string, string>();
const fakeKV: KVNamespace = {
  get: async (key: string, type?: "text" | "json") => {
    const value = kvStore.get(key);
    if (value === undefined) return null;
    return type === "json" ? (JSON.parse(value) as unknown) : value;
  },
  put: async (key: string, value: string | ArrayBuffer | ReadableStream) => {
    kvStore.set(key, String(value));
  },
  delete: async (key: string) => {
    kvStore.delete(key);
  },
} as unknown as KVNamespace;

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

async function pesapalIpn(trackingId: string): Promise<Response> {
  return await app.request(
    "/webhooks/pesapal-ipn",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderTrackingId: trackingId }) },
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
      title: "Order test item",
      description: "An item used to test orders and escrow.",
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

async function placeAndAcceptBid(buyerToken: string, sellerToken: string, productId: string, amount: number): Promise<void> {
  const place = await app.request(`/products/${productId}/bids`, json(buyerToken, { amount, currency: "RWF" }), env);
  assert(place.status === 201, `place bid failed with ${place.status}`);
  const bid = ((await place.json()) as { bid: Bid & { id: string } }).bid;
  const accept = await app.request(`/bids/${bid.id}/accept`, authedPost(sellerToken), env);
  assert(accept.status === 200, `accept bid failed with ${accept.status}`);
}

async function getOrder(token: string, orderId: string): Promise<{ order: Order & { id: string }; product: unknown; buyer: unknown; seller: unknown }> {
  const res = await app.request(`/orders/${orderId}`, bearer(token), env);
  assert(res.status === 200, `GET /orders/${orderId} failed with ${res.status}`);
  return (await res.json()) as never;
}

async function wallet(token: string): Promise<{ walletBalance: number; transactions: Array<{ id: string; type: string; amount: number; currency: string; orderId: string | null }> }> {
  const res = await app.request("/wallet", bearer(token), env);
  assert(res.status === 200, `GET /wallet failed with ${res.status}`);
  return (await res.json()) as never;
}

let env: Record<string, unknown>;
let sellerToken: string;
let buyerToken: string;
let strangerToken: string;
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
      OTP_KV: fakeKV,
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
    sellerToken = await mintToken({ ...claims, sub: "seller-1", name: "Seller", email: "seller@example.com" }, privateKey);
    buyerToken = await mintToken({ ...claims, sub: "buyer-1", name: "Buyer One", email: "buyer1@example.com" }, privateKey);
    strangerToken = await mintToken({ ...claims, sub: "buyer-2", name: "Buyer Two", email: "buyer2@example.com" }, privateKey);

    db = new FirestoreClient({
      projectId: PROJECT_ID,
      clientEmail: "test@example.com",
      privateKey: "test-key",
      apiUrl: API_URL,
      accessTokenProvider: async () => "test-access-token",
    });
    for (const u of [
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
      });
    }

    // ---- A. RWF accepted-bid flow (deliveryFeePayer = buyer) ----------------
    const productA = await createProduct(sellerToken, {
      title: "Bid escrow item",
      isBiddingEnabled: true,
      priceAmount: 50000,
      deliveryFee: 5000,
      deliveryFeePayer: "buyer",
    });
    await placeAndAcceptBid(buyerToken, sellerToken, productA, 46000);

    // Order creation guards
    const notReservedProduct = await createProduct(sellerToken, { title: "Not reserved item", priceAmount: 1000 });
    const orderNotReserved = await app.request("/orders", json(buyerToken, { productId: notReservedProduct }), env);
    assert(orderNotReserved.status === 409, `unreserved product should be 409, got ${orderNotReserved.status}`);

    const strangerOrder = await app.request("/orders", json(strangerToken, { productId: productA }), env);
    assert(strangerOrder.status === 403, `non-holder should be 403, got ${strangerOrder.status}`);

    // POST /orders with the buyer's phone
    const createRes = await app.request("/orders", json(buyerToken, { productId: productA, phoneNumber: "0788123456" }), env);
    assert(createRes.status === 200, `POST /orders failed with ${createRes.status}`);
    const created = (await createRes.json()) as { order: Order & { id: string } };
    const orderA = created.order;
    assert(orderA.escrowStatus === "pending_payment", "order should start pending_payment");
    assert(orderA.agreedAmount === 46000, "agreedAmount should be the accepted bid");
    assert(orderA.totalPaid === 51000, "totalPaid = agreedAmount + deliveryFee");
    assert(orderA.deliveryFeePayer === "buyer", "deliveryFeePayer mismatch");
    assert(orderA.paymentProvider === "paypack", "RWF orders use paypack");
    assert(orderA.buyerPhoneNumber === "0788123456", "buyer phone stored");
    assert(orderA.paymentReference === `cashin-${orderA.id}`, "paymentReference is the paypack ref");
    assert(paypackCashins.length === 1, "one cashin issued");
    assert(paypackCashins[0]!.idempotencyKey === orderA.id, "cashin idempotency key = order id");
    assert(paypackCashins[0]!.amount === 51000, "cashin amount = totalPaid");
    assert(paypackCashins[0]!.environment === "production", "production environment sent");

    // Idempotent re-POST reuses the pending order (double-click safe).
    const duplicate = await app.request("/orders", json(buyerToken, { productId: productA, phoneNumber: "0788123456" }), env);
    assert(duplicate.status === 200, `duplicate POST /orders failed with ${duplicate.status}`);
    const duplicateBody = (await duplicate.json()) as { order: Order & { id: string } };
    assert(duplicateBody.order.id === orderA.id, "duplicate POST should return the same pending order");
    assert(paypackCashins.length === 1, "no second cashin for duplicate POST");

    // GET /orders/:id access control + shape
    const strangerView = await app.request(`/orders/${orderA.id}`, bearer(strangerToken), env);
    assert(strangerView.status === 403, `stranger should get 403, got ${strangerView.status}`);
    const buyerView = await getOrder(buyerToken, orderA.id);
    assert(buyerView.order.id === orderA.id, "buyer can view own order");
    assert((buyerView.seller as { name: string }).name === "Seller", "seller summary included");
    assert((buyerView.product as { title: string }).title === "Bid escrow item", "product summary included");
    const missing = await app.request("/orders/nonexistent", bearer(buyerToken), env);
    assert(missing.status === 404, `unknown order should be 404, got ${missing.status}`);

    // Webhook guards
    const badSig = await app.request(
      "/webhooks/paypack",
      { method: "POST", headers: { "Content-Type": "application/json", "X-Paypack-Signature": "wrong" }, body: "{}" },
      env,
    );
    assert(badSig.status === 401, `bad signature should be 401, got ${badSig.status}`);
    const noSig = await app.request("/webhooks/paypack", { method: "POST", body: "{}" }, env);
    assert(noSig.status === 401, `missing signature should be 401, got ${noSig.status}`);

    // Success webhook -> held, sold, deadline set
    const ack = await paypackWebhook({ ref: orderA.paymentReference, status: "successful", kind: "CASHIN" });
    assert(ack.status === 200, `webhook ack failed with ${ack.status}`);
    const heldA = await getOrder(buyerToken, orderA.id);
    assert(heldA.order.escrowStatus === "held", "escrow should be held after successful payment");
    assert(heldA.order.deliveryDeadline.length > 0, "delivery deadline should be set");
    assert((heldA.product as { status: string }).status === "sold", "product should be sold");
    const heldAgain = await paypackWebhook({ ref: orderA.paymentReference, status: "successful", kind: "CASHIN" });
    assert(heldAgain.status === 200, "duplicate webhook should ack");

    // Confirm delivery: buyer first, then seller releases escrow
    const confirmBuyer = await app.request(
      `/orders/${orderA.id}/confirm-delivery`,
      json(buyerToken, { received: true, rating: 5, comment: "Arrived in perfect condition" }),
      env,
    );
    assert(confirmBuyer.status === 200, `buyer confirm failed with ${confirmBuyer.status}`);
    const afterBuyerConfirm = (await confirmBuyer.json()) as { order: Order & { id: string } };
    assert(afterBuyerConfirm.order.buyerConfirmedDelivery === true, "buyer confirmation recorded");
    assert(afterBuyerConfirm.order.escrowStatus === "held", "still held until both confirm");

    const confirmStranger = await app.request(
      `/orders/${orderA.id}/confirm-delivery`,
      json(strangerToken, { received: true, rating: 1 }),
      env,
    );
    assert(confirmStranger.status === 403, `stranger confirm should be 403, got ${confirmStranger.status}`);

    const confirmSeller = await app.request(
      `/orders/${orderA.id}/confirm-delivery`,
      json(sellerToken, { received: true, rating: 4 }),
      env,
    );
    assert(confirmSeller.status === 200, `seller confirm failed with ${confirmSeller.status}`);
    const releasedA = (await confirmSeller.json()) as { order: Order & { id: string } };
    assert(releasedA.order.escrowStatus === "released", "escrow released when both confirm");
    assert(releasedA.order.sellerConfirmedDelivery === true, "seller confirmation recorded");
    assert((releasedA.order.buyerFeedback as { rating: number }).rating === 5, "buyer feedback stored");
    assert((releasedA.order.sellerFeedback as { rating: number }).rating === 4, "seller feedback stored");

    // Seller wallet credited the FULL agreedAmount (deliveryFeePayer = buyer)
    let sellerWallet = await wallet(sellerToken);
    const balanceAfterA = sellerWallet.walletBalance;
    const creditTx = sellerWallet.transactions[0]!;
    assert(balanceAfterA === 46000, `seller balance should be 46000, got ${balanceAfterA}`);
    assert(sellerWallet.transactions.length === 1, "one credit transaction");
    assert(creditTx.type === "credit", "credit transaction");
    assert(creditTx.amount === 46000, "credit = full agreedAmount");
    assert(creditTx.orderId === orderA.id, "credit references the order");

    const confirmReleased = await app.request(
      `/orders/${orderA.id}/confirm-delivery`,
      json(buyerToken, { received: true, rating: 5 }),
      env,
    );
    assert(confirmReleased.status === 409, `confirm on released order should be 409, got ${confirmReleased.status}`);

    // Ratings were applied to the counterpart users (buyer->seller 5, seller->buyer 4)
    const ratedSeller = await db.getDoc<User>(`${collections.users}/seller-1`);
    const ratedBuyer = await db.getDoc<User>(`${collections.users}/buyer-1`);
    assert(ratedSeller!.avgRating === 5, `seller avgRating should be 5, got ${ratedSeller!.avgRating}`);
    assert(ratedSeller!.ratingCount === 1, "seller ratingCount should be 1");
    assert(ratedBuyer!.avgRating === 4, `buyer avgRating should be 4, got ${ratedBuyer!.avgRating}`);
    assert(ratedBuyer!.ratingCount === 1, "buyer ratingCount should be 1");

    // ---- A2. Messaging: parties can chat, others are blocked -----------------
    const emptyThread = await app.request(`/orders/${orderA.id}/messages`, bearer(buyerToken), env);
    assert(emptyThread.status === 200, `empty thread should be 200, got ${emptyThread.status}`);
    const emptyBody = (await emptyThread.json()) as { messages: unknown[] };
    assert(emptyBody.messages.length === 0, "no messages yet");

    const strangerMsg = await app.request(
      `/orders/${orderA.id}/messages`,
      json(strangerToken, { text: "hi" }),
      env,
    );
    assert(strangerMsg.status === 403, `stranger message should be 403, got ${strangerMsg.status}`);

    const blankMsg = await app.request(`/orders/${orderA.id}/messages`, json(buyerToken, { text: "   " }), env);
    assert(blankMsg.status === 400, `blank message should be 400, got ${blankMsg.status}`);
    const overlongMsg = await app.request(
      `/orders/${orderA.id}/messages`,
      json(buyerToken, { text: "x".repeat(2001) }),
      env,
    );
    assert(overlongMsg.status === 400, `overlong message should be 400, got ${overlongMsg.status}`);

    const buyerSend = await app.request(
      `/orders/${orderA.id}/messages`,
      json(buyerToken, { text: "When will you ship?" }),
      env,
    );
    assert(buyerSend.status === 201, `buyer message send failed with ${buyerSend.status}`);
    const buyerMsg = ((await buyerSend.json()) as { message: { id: string; senderId: string; text: string } }).message;
    assert(buyerMsg.senderId === "buyer-1" && buyerMsg.text === "When will you ship?", "buyer message stored");

    const sellerReply = await app.request(
      `/orders/${orderA.id}/messages`,
      json(sellerToken, { text: "Tomorrow morning." }),
      env,
    );
    assert(sellerReply.status === 201, `seller reply failed with ${sellerReply.status}`);

    const thread = (await (await app.request(`/orders/${orderA.id}/messages`, bearer(sellerToken), env)).json()) as {
      messages: Array<{ id: string; senderId: string; text: string; isRead: boolean }>;
    };
    assert(thread.messages.length === 2, "two messages in thread");
    assert(thread.messages[0]!.text === "When will you ship?", "oldest first");
    assert(thread.messages[1]!.text === "Tomorrow morning.", "newest last");
    assert(thread.messages[0]!.isRead === false && thread.messages[1]!.isRead === false, "own messages stored unread");

    // Mark-read: buyer marks the seller's reply as read
    const markRead = await app.request(`/orders/${orderA.id}/messages/read`, authedPost(buyerToken), env);
    assert(markRead.status === 200, `mark-read failed with ${markRead.status}`);
    const markReadBody = (await markRead.json()) as { updated: number };
    assert(markReadBody.updated === 1, "one unread message for the buyer");
    const readThread = (await (await app.request(`/orders/${orderA.id}/messages`, bearer(buyerToken), env)).json()) as {
      messages: Array<{ isRead: boolean }>;
    };
    assert(readThread.messages[1]!.isRead === true, "reply marked read");

    // ---- A3. can-confirm reflects the current state ---------------------------
    const canConfirm = (await (await app.request(`/orders/${orderA.id}/can-confirm`, bearer(buyerToken), env)).json()) as {
      allowed: boolean;
      escrowStatus: string;
    };
    assert(canConfirm.allowed === false && canConfirm.escrowStatus === "released", "cannot confirm a released order");

    // ---- A4. Dispute: received:false flags the order, holds funds -------------
    const productDisp = await createProduct(sellerToken, { title: "Disputed item", priceAmount: 8000 });
    await reserve(buyerToken, productDisp);
    const createDisp = await app.request("/orders", json(buyerToken, { productId: productDisp, phoneNumber: "0788123456" }), env);
    const orderDisp = ((await createDisp.json()) as { order: Order & { id: string } }).order;
    await paypackWebhook({ ref: orderDisp.paymentReference, status: "successful", kind: "CASHIN" });

    const noReasonDispute = await app.request(
      `/orders/${orderDisp.id}/confirm-delivery`,
      json(buyerToken, { received: false }),
      env,
    );
    assert(noReasonDispute.status === 400, `dispute without reason should be 400, got ${noReasonDispute.status}`);

    const disputeRes = await app.request(
      `/orders/${orderDisp.id}/confirm-delivery`,
      json(buyerToken, { received: false, comment: "Never arrived, no tracking number." }),
      env,
    );
    assert(disputeRes.status === 200, `dispute flag should be 200, got ${disputeRes.status}`);
    const disputed = (await disputeRes.json()) as { order: Order & { id: string } };
    assert(disputed.order.hasDispute === true, "order flagged as dispute");
    assert(disputed.order.disputeReason === "Never arrived, no tracking number.", "dispute reason stored");
    assert(disputed.order.escrowStatus === "held", "funds stay held on dispute");
    assert(disputed.order.buyerFeedback == null, "no rating recorded for a disputed delivery");

    // The seller cannot auto-release a disputed order.
    const releaseDisp = await app.request(
      `/orders/${orderDisp.id}/confirm-delivery`,
      json(sellerToken, { received: true, rating: 5 }),
      env,
    );
    assert(releaseDisp.status === 409, `releasing a disputed order should be 409, got ${releaseDisp.status}`);

    // ---- B. RWF direct-buy with deliveryFeePayer = seller --------------------
    const productB = await createProduct(sellerToken, {
      title: "Direct escrow item",
      priceAmount: 50000,
      deliveryFee: 3000,
      deliveryFeePayer: "seller",
    });
    await reserve(buyerToken, productB);
    const createB = await app.request("/orders", json(buyerToken, { productId: productB, phoneNumber: "0788123456" }), env);
    assert(createB.status === 200, `POST /orders B failed with ${createB.status}`);
    const orderB = ((await createB.json()) as { order: Order & { id: string } }).order;
    assert(orderB.totalPaid === 53000, "totalPaid includes delivery fee even when seller pays it");

    // Failed payment webhook -> order failed, product back to active
    const failAck = await paypackWebhook({ ref: orderB.paymentReference, status: "failed", kind: "CASHIN" });
    assert(failAck.status === 200, `failed webhook ack failed with ${failAck.status}`);
    const failedB = await getOrder(buyerToken, orderB.id);
    assert(failedB.order.escrowStatus === "failed", "order should be failed");
    assert((failedB.product as { status: string }).status === "active", "product should be active again");

    // Retry reuses the failed order id (idempotency preserved). The failed
    // webhook cleared the reservation, so the buyer reserves again first.
    const retryWithoutReserve = await app.request("/orders", json(buyerToken, { productId: productB, phoneNumber: "0788123456" }), env);
    assert(retryWithoutReserve.status === 409, `unreserved retry should be 409, got ${retryWithoutReserve.status}`);
    await reserve(buyerToken, productB);
    const retryB = await app.request("/orders", json(buyerToken, { productId: productB, phoneNumber: "0788123456" }), env);
    assert(retryB.status === 200, `retry POST /orders B failed with ${retryB.status}`);
    const retriedB = ((await retryB.json()) as { order: Order & { id: string } }).order;
    assert(retriedB.id === orderB.id, "retry should reuse the failed order");
    assert(retriedB.escrowStatus === "pending_payment", "order back to pending_payment on retry");

    // Reuse-after-failure retry should be able to succeed.
    await paypackWebhook({ ref: retriedB.paymentReference, status: "successful", kind: "CASHIN" });
    await app.request(
      `/orders/${orderB.id}/confirm-delivery`,
      json(buyerToken, { received: true, rating: 5 }),
      env,
    );
    const confirmB = await app.request(
      `/orders/${orderB.id}/confirm-delivery`,
      json(sellerToken, { received: true, rating: 5 }),
      env,
    );
    assert(confirmB.status === 200, `confirm B failed with ${confirmB.status}`);

    // deliveryFeePayer = seller -> seller receives agreedAmount - deliveryFee
    sellerWallet = await wallet(sellerToken);
    const balanceAfterB = sellerWallet.walletBalance;
    const newestCredit = sellerWallet.transactions[0]!.amount;
    assert(balanceAfterB === 93000, `seller balance should now be 93000, got ${balanceAfterB}`);
    assert(newestCredit === 47000, "seller absorbs the delivery fee");

    // ---- C. RWF provider-down handling (502 -> failed order, retry works) ----
    const productC = await createProduct(sellerToken, { title: "Provider down item", priceAmount: 20000 });
    await reserve(buyerToken, productC);
    paypackCashinShouldFail = true;
    const failRes = await app.request("/orders", json(buyerToken, { productId: productC, phoneNumber: "0788123456" }), env);
    assert(failRes.status === 502, `expected 502 when paypack down, got ${failRes.status}`);
    const failBody = (await failRes.json()) as { error?: string };
    assert(typeof failBody.error === "string" && failBody.error.length > 0, "502 response includes error message");
    paypackCashinShouldFail = false;

    // The failed order exists; retrying reuses it and succeeds.
    const orderC = await db.queryCollection<Order>(collections.orders, {
      filters: [{ field: "productId", op: "==", value: productC }],
      limit: 1,
    });
    assert(orderC[0]?.escrowStatus === "failed", "order marked failed when cashin throws");
    const retryC = await app.request("/orders", json(buyerToken, { productId: productC, phoneNumber: "0788123456" }), env);
    assert(retryC.status === 200, `retry C failed with ${retryC.status}`);
    const retriedC = ((await retryC.json()) as { order: Order & { id: string } }).order;
    assert(retriedC.id === orderC[0]!.id, "provider-down retry reuses the failed order");
    assert(retriedC.escrowStatus === "pending_payment", "provider-down retry returns to pending_payment");

    // ---- D. USD Pesapal flow (deliveryFeePayer = buyer) ----------------------
    const productD = await createProduct(sellerToken, {
      title: "Card item",
      priceAmount: 150,
      priceCurrency: "USD",
      deliveryFee: 20,
      deliveryFeePayer: "buyer",
    });
    await reserve(buyerToken, productD);
    const createD = await app.request("/orders", json(buyerToken, { productId: productD }), env);
    assert(createD.status === 200, `POST /orders D failed with ${createD.status}`);
    const orderD = (await createD.json()) as { order: Order & { id: string }; redirectUrl: string };
    assert(orderD.order.paymentProvider === "pesapal", "USD orders use pesapal");
    assert(orderD.order.paymentReference === "tracking-1", "paymentReference = order_tracking_id");
    assert(orderD.redirectUrl.includes("tracking-1"), "redirect_url returned for frontend");
    assert(pesapalIpnRegistrations === 1, "IPN registered exactly once (cached in Firestore)");
    assert(pesapalSubmissions[0]!.id === orderD.order.id, "submitOrder sent with order id");
    assert(pesapalSubmissions[0]!.amount === 170, "submitOrder amount = totalPaid (150 + 20)");
    assert(pesapalSubmissions[0]!.notificationId === "ipn-1", "submitOrder uses registered IPN id");

    // Second USD order must reuse the cached IPN id (no re-registration).
    const productE = await createProduct(sellerToken, {
      title: "Card item 2",
      priceAmount: 200,
      priceCurrency: "USD",
      deliveryFee: 10,
      deliveryFeePayer: "seller",
    });
    await reserve(buyerToken, productE);
    const createE = await app.request("/orders", json(buyerToken, { productId: productE }), env);
    assert(createE.status === 200, `POST /orders E failed with ${createE.status}`);
    const orderE = ((await createE.json()) as { order: Order & { id: string } }).order;
    assert(orderE.paymentReference === "tracking-2", "second tracking id");
    assert(pesapalIpnRegistrations === 1, "IPN id cached; no second registration");

    // IPN COMPLETED (status_code 1) -> held + sold
    const ipnDone = await pesapalIpn("tracking-1");
    assert(ipnDone.status === 200, `IPN ack failed with ${ipnDone.status}`);
    const ipnBody = (await ipnDone.json()) as { status: number; orderTrackingId: string };
    assert(ipnBody.status === 200 && ipnBody.orderTrackingId === "tracking-1", "IPN ack body");
    const heldD = await getOrder(buyerToken, orderD.order.id);
    assert(heldD.order.escrowStatus === "held", "pesapal order held after IPN");
    assert((heldD.product as { status: string }).status === "sold", "pesapal product sold");

    // Confirm + release: seller credit = 150 (buyer paid the delivery fee)
    await app.request(
      `/orders/${orderD.order.id}/confirm-delivery`,
      json(buyerToken, { received: true, rating: 5 }),
      env,
    );
    const confirmD = await app.request(
      `/orders/${orderD.order.id}/confirm-delivery`,
      json(sellerToken, { received: true, rating: 5 }),
      env,
    );
    assert(confirmD.status === 200, `confirm D failed with ${confirmD.status}`);
    sellerWallet = await wallet(sellerToken);
    assert(sellerWallet.walletBalance === 93000 + 150, `seller balance should be 93150, got ${sellerWallet.walletBalance}`);

    // IPN FAILED (status_code 2) -> order failed, product active
    pesapalStatusByTracking.set("tracking-2", 2);
    const ipnFail = await pesapalIpn("tracking-2");
    assert(ipnFail.status === 200, `IPN fail ack failed with ${ipnFail.status}`);
    const failedE = await getOrder(buyerToken, orderE.id);
    assert(failedE.order.escrowStatus === "failed", "pesapal order should fail on status_code 2");
    assert((failedE.product as { status: string }).status === "active", "pesapal product back to active");

    // ---- E. Auto-refund: Paypack cashout (refunded) --------------------------
    const productF = await createProduct(sellerToken, { title: "Auto refund RWF", priceAmount: 10000 });
    await reserve(buyerToken, productF);
    const createF = await app.request("/orders", json(buyerToken, { productId: productF, phoneNumber: "0788123456" }), env);
    const orderF = ((await createF.json()) as { order: Order & { id: string } }).order;
    await paypackWebhook({ ref: orderF.paymentReference, status: "successful", kind: "CASHIN" });
    await db.updateDoc<Order>(`${collections.orders}/${orderF.id}`, {
      deliveryDeadline: new Date(Date.now() - 1000).toISOString(),
    });
    const paypackResult = await processExpiredOrders(env as never);
    assert(paypackResult.refunded === 1, "one paypack order refunded");
    assert(paypackCashouts.length === 1, "cashout issued for refund");
    assert(paypackCashouts[0]!.idempotencyKey === orderF.id, "refund cashout idempotency key = order id");
    assert(paypackCashouts[0]!.amount === 10000, "refund amount = totalPaid");
    const refundedF = await getOrder(buyerToken, orderF.id);
    assert(refundedF.order.escrowStatus === "refunded", "paypack order refunded");
    assert((refundedF.product as { status: string }).status === "active", "refunded product back to active");

    // ---- F. Auto-refund: Pesapal refund request (refund_requested) -----------
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
    await pesapalIpn(trackingG);
    await db.updateDoc<Order>(`${collections.orders}/${orderG.id}`, {
      deliveryDeadline: new Date(Date.now() - 1000).toISOString(),
    });
    const pesapalResult = await processExpiredOrders(env as never);
    assert(pesapalResult.requested === 1, "one pesapal refund requested");
    const requestedG = await getOrder(buyerToken, orderG.id);
    assert(requestedG.order.escrowStatus === "refund_requested", "pesapal refunds are approval-tracked");

    // Buyer-side refund transaction recorded for both providers
    const buyerRefunds = await db.queryCollection<{ type: string; amount: number; currency: string }>(
      collections.walletTransactions,
      {
        filters: [
          { field: "userId", op: "==", value: "buyer-1" },
          { field: "type", op: "==", value: "refund" },
        ],
      },
    );
    assert(buyerRefunds.length === 2, "two refund transactions for the buyer");

    // ---- G. Wallet withdrawals (RWF via paypack cashout) ----------------------
    const unauthWallet = await app.request("/wallet", {}, env);
    assert(unauthWallet.status === 401, `unauth wallet should be 401, got ${unauthWallet.status}`);
    const unauthWithdraw = await app.request("/wallet/withdraw", { method: "POST" }, env);
    assert(unauthWithdraw.status === 401, `unauth withdraw should be 401, got ${unauthWithdraw.status}`);

    sellerWallet = await wallet(sellerToken);
    const preWithdrawBalance = sellerWallet.walletBalance;
    assert(preWithdrawBalance === 93150, `pre-withdraw balance should be 93150, got ${preWithdrawBalance}`);
    assert(sellerWallet.transactions.length >= 3, "transaction history includes credits");

    const tooBig = await app.request("/wallet/withdraw", json(sellerToken, { amount: 999999, phoneNumber: "0788123456" }), env);
    assert(tooBig.status === 400, `over-balance withdraw should be 400, got ${tooBig.status}`);

    const badPhone = await app.request("/wallet/withdraw", json(sellerToken, { amount: 100, phoneNumber: "abc" }), env);
    assert(badPhone.status === 400, `bad phone should be 400, got ${badPhone.status}`);

    paypackCashouts.length = 0;
    const withdrawRes = await app.request("/wallet/withdraw", json(sellerToken, { amount: 30000, phoneNumber: "0788123456" }), env);
    assert(withdrawRes.status === 200, `withdraw failed with ${withdrawRes.status}`);
    const withdrawBody = (await withdrawRes.json()) as { transaction: { id: string; type: string }; walletBalance: number };
    assert(withdrawBody.transaction.type === "debit", "withdrawal is a debit");
    assert(withdrawBody.walletBalance === 63150, "balance debited");
    assert(paypackCashouts.length === 1, "withdrawal triggers a cashout");
    assert(
      paypackCashouts[0]!.idempotencyKey === `withdraw-seller-1-${withdrawBody.transaction.id}`,
      "withdraw idempotency key = withdraw-{uid}-{txId}",
    );

    const afterWithdraw = await wallet(sellerToken);
    assert(afterWithdraw.walletBalance === 63150, "wallet reflects withdrawal");
    assert(afterWithdraw.transactions[0]!.type === "debit", "debit is newest transaction");

    // Cashout failure restores the balance and reclassifies the transaction.
    paypackCashoutShouldFail = true;
    const failWithdraw = await app.request("/wallet/withdraw", json(sellerToken, { amount: 5000, phoneNumber: "0788123456" }), env);
    assert(failWithdraw.status === 502, `failed cashout should be 502, got ${failWithdraw.status}`);
    paypackCashoutShouldFail = false;
    const restored = await wallet(sellerToken);
    assert(restored.walletBalance === 63150, "balance restored after failed cashout");
    assert(restored.transactions[0]!.type === "refund", "failed withdrawal reclassified to refund");

    console.log(
      "ORDER TESTS PASSED (escrow lifecycle, paypack webhooks + signature, pesapal IPN, delivery release math, auto-refund, wallet withdraw)",
    );
  } finally {
    jwksServer.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
