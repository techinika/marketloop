// End-to-end tests for the bidding + direct-buy reservation flow.
//
// Same harness as test-products.ts: real Hono app, mock JWKS + minted RS256
// tokens, in-memory Firestore REST mock.
//
// Run with: npm run test:bids

import { createServer } from "node:http";

import app from "../src/index";
import { FirestoreClient, type FirestoreDocument, type FirestoreField } from "../src/lib/firestore";
import { collections, type Bid, type Product, type User } from "../src/models";

const PROJECT_ID = "marketloop-rw";
const JWKS_PORT = 8800;
const JWKS_URL = `http://127.0.0.1:${JWKS_PORT}/jwks`;
const KID = "test-kid-3";
const API_URL = "http://firestore.local/v1";
const TIME = "2026-08-13T00:00:00Z";

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

// ---- In-memory Firestore REST mock -----------------------------------------

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
            compositeFilter?: { filters: Array<{ fieldFilter: { field: { fieldPath: string }; value: FirestoreField } }> };
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
    const filters: Array<{ fieldPath: string; value: FirestoreField }> = [];
    if (q?.where) {
      if ("fieldFilter" in q.where && q.where.fieldFilter) {
        const ff = q.where.fieldFilter as { field: { fieldPath: string }; value: FirestoreField };
        filters.push({ fieldPath: ff.field.fieldPath, value: ff.value });
      }
      if ("compositeFilter" in q.where && q.where.compositeFilter) {
        for (const f of q.where.compositeFilter.filters) {
          filters.push({ fieldPath: f.fieldFilter.field.fieldPath, value: f.fieldFilter.value });
        }
      }
    }
    let entries = [...store.entries()].filter(([key]) => key.startsWith(`${collectionId}/`));
    for (const { fieldPath, value } of filters) {
      const want = JSON.stringify(decodeValue(value));
      entries = entries.filter(([, doc]) => JSON.stringify(decodeValue(doc.fields[fieldPath]!)) === want);
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

// ---- R2 binding stub --------------------------------------------------------

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

function authedPost(token: string): RequestInit {
  return { method: "POST", headers: { Authorization: `Bearer ${token}` } };
}

function json(token: string, payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

async function createProduct(
  env: Record<string, unknown>,
  token: string,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<string> {
  const res = await app.request(
    "/products",
    json(token, {
      title: "Bid test item",
      description: "An item used to test bidding.",
      category: "Electronics",
      priceAmount: 50000,
      priceCurrency: "RWF",
      isNegotiable: true,
      isBiddingEnabled: true,
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

async function main(): Promise<void> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "firestore.local") return Promise.resolve(firestoreMock(input, init));
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
    const env = {
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
      PAYPACK_CLIENT_ID: "",
      PAYPACK_CLIENT_SECRET: "",
      PESAPAL_CONSUMER_KEY: "",
      PESAPAL_CONSUMER_SECRET: "",
    };

    const now = Math.floor(Date.now() / 1000);
    const claims = {
      aud: PROJECT_ID,
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      auth_time: now - 60,
      iat: now - 60,
      exp: now + 3600,
    };
    const sellerToken = await mintToken(
      { ...claims, sub: "seller-1", name: "Seller", email: "seller@example.com", picture: "https://example.com/s.png" },
      privateKey,
    );
    const buyerToken = await mintToken(
      { ...claims, sub: "buyer-1", name: "Buyer One", email: "buyer1@example.com", picture: "https://example.com/b1.png" },
      privateKey,
    );
    const buyer2Token = await mintToken(
      { ...claims, sub: "buyer-2", name: "Buyer Two", email: "buyer2@example.com", picture: "https://example.com/b2.png" },
      privateKey,
    );

    const db = new FirestoreClient({
      projectId: PROJECT_ID,
      clientEmail: "test@example.com",
      privateKey: "test-key",
      apiUrl: API_URL,
      accessTokenProvider: async () => "test-access-token",
    });
    for (const u of [
      { uid: "seller-1", name: "Seller", email: "seller@example.com", photoUrl: "https://example.com/s.png" },
      { uid: "buyer-1", name: "Buyer One", email: "buyer1@example.com", photoUrl: "https://example.com/b1.png" },
      { uid: "buyer-2", name: "Buyer Two", email: "buyer2@example.com", photoUrl: "https://example.com/b2.png" },
    ]) {
      await db.createDoc<User>(collections.users, u.uid, {
        uid: u.uid,
        name: u.name,
        email: u.email,
        photoUrl: u.photoUrl,
        phone: null,
        walletBalance: 0,
        createdAt: new Date(now * 1000).toISOString(),
        rating: null,
      });
    }

    const biddingProductId = await createProduct(env, sellerToken, { isBiddingEnabled: true });
    const nonBiddingProductId = await createProduct(env, sellerToken, {
      isBiddingEnabled: false,
      title: "Direct buy item",
    });

    // 1. Bids only allowed on bidding-enabled products.
    const bidOnNonBidding = await app.request(
      `/products/${nonBiddingProductId}/bids`,
      json(buyerToken, { amount: 100, currency: "RWF" }),
      env,
    );
    assert(bidOnNonBidding.status === 400, `expected 400 on non-bidding product, got ${bidOnNonBidding.status}`);

    // 2. Seller cannot bid on their own product.
    const selfBid = await app.request(
      `/products/${biddingProductId}/bids`,
      json(sellerToken, { amount: 100, currency: "RWF" }),
      env,
    );
    assert(selfBid.status === 400, `expected 400 for self-bid, got ${selfBid.status}`);

    // 3. The buyer never sends a currency — bids use the product's price currency.
    const placeRes = await app.request(
      `/products/${biddingProductId}/bids`,
      json(buyerToken, { amount: 42000 }),
      env,
    );
    assert(placeRes.status === 201, `expected 201, got ${placeRes.status}`);
    const placed = (await placeRes.json()) as { bid: Bid & { id: string } };
    assert(placed.bid.amount === 42000, "bid amount mismatch");
    assert(placed.bid.status === "active", "bid should be active");
    assert(placed.bid.buyerId === "buyer-1", "bid buyer mismatch");
    assert(placed.bid.currency === "RWF", "bid should use the product's currency");
    const buyerBidId = placed.bid.id;

    // 4. Update own bid instead of creating a new one.
    const updateRes = await app.request(
      `/products/${biddingProductId}/bids`,
      json(buyerToken, { amount: 43000 }),
      env,
    );
    assert(updateRes.status === 200, `expected 200 on update, got ${updateRes.status}`);
    const updated = (await updateRes.json()) as { bid: Bid & { id: string } };
    assert(updated.bid.id === buyerBidId, "update should reuse the same bid");
    assert(updated.bid.amount === 43000, "updated amount mismatch");

    // 6. Public summary: count + highest, no bidder identities.
    const summaryRes = await app.request(`/products/${biddingProductId}/bids`, {}, env);
    const summary = (await summaryRes.json()) as { bidCount: number; highestBid: number | null; currency: string };
    assert(summary.bidCount === 1, `expected 1 bid, got ${summary.bidCount}`);
    assert(summary.highestBid === 43000, "highest bid mismatch");
    assert(summary.currency === "RWF", "summary currency mismatch");
    const summaryText = JSON.stringify(summary);
    assert(!summaryText.includes("Buyer One"), "public summary leaked bidder identity");

    // 7. bids/mine returns own active bid.
    const mineRes = await app.request(`/products/${biddingProductId}/bids/mine`, bearer(buyerToken), env);
    const mine = (await mineRes.json()) as { bid: (Bid & { id: string }) | null };
    assert(mine.bid?.id === buyerBidId, "bids/mine should return own bid");

    // 8. Second buyer bids higher; seller's all-view is sorted highest first.
    await app.request(`/products/${biddingProductId}/bids`, json(buyer2Token, { amount: 50000, currency: "RWF" }), env);

    const allRes = await app.request(`/products/${biddingProductId}/bids/all`, bearer(sellerToken), env);
    assert(allRes.status === 200, `expected 200 for bids/all, got ${allRes.status}`);
    const all = (await allRes.json()) as {
      bids: Array<{ id: string; amount: number; createdAt: string; buyer: { uid: string; name: string; photoUrl: string | null } }>;
    };
    assert(all.bids.length === 2, `expected 2 active bids, got ${all.bids.length}`);
    assert(all.bids[0]!.amount === 50000, "highest bid should come first");
    assert(all.bids[0]!.buyer.name === "Buyer Two", "bidder name missing");
    assert(all.bids[0]!.buyer.photoUrl === "https://example.com/b2.png", "bidder photo missing");
    assert(!("email" in all.bids[0]!.buyer), "bidder email leaked");

    const buyerCantView = await app.request(`/products/${biddingProductId}/bids/all`, bearer(buyerToken), env);
    assert(buyerCantView.status === 403, `expected 403 for non-seller bids/all, got ${buyerCantView.status}`);

    // 9. Withdraw own bid; other user cannot withdraw it.
    const withdrawRes = await app.request(`/bids/${buyerBidId}/withdraw`, authedPost(buyerToken), env);
    assert(withdrawRes.status === 200, `expected 200 on withdraw, got ${withdrawRes.status}`);
    const withdrawn = (await withdrawRes.json()) as { bid: Bid };
    assert(withdrawn.bid.status === "withdrawn", "bid should be withdrawn");

    const withdrawAgain = await app.request(`/bids/${buyerBidId}/withdraw`, authedPost(buyerToken), env);
    assert(withdrawAgain.status === 409, `expected 409 on double-withdraw, got ${withdrawAgain.status}`);

    const buyer2CantWithdraw = await app.request(`/bids/${buyerBidId}/withdraw`, authedPost(buyer2Token), env);
    assert(buyer2CantWithdraw.status === 403, `expected 403 for non-owner withdraw, got ${buyer2CantWithdraw.status}`);

    // Re-place the buyer's bid so it's active again for the accept test.
    const replaced = await app.request(
      `/products/${biddingProductId}/bids`,
      json(buyerToken, { amount: 46000, currency: "RWF" }),
      env,
    );
    assert(replaced.status === 201, "re-placed bid should be a new creation");
    const replacedBid = ((await replaced.json()) as { bid: Bid & { id: string } }).bid;

    // 10. Accept a bid: accepted, others withdrawn, product reserved.
    const acceptRes = await app.request(`/bids/${replacedBid.id}/accept`, authedPost(sellerToken), env);
    assert(acceptRes.status === 200, `expected 200 on accept, got ${acceptRes.status}`);
    const accepted = (await acceptRes.json()) as {
      bid: Bid & { id: string };
      product: Product & { id: string };
      checkout: { productId: string; buyerId: string; amount: number; currency: string };
    };
    assert(accepted.bid.status === "accepted", "accepted bid status mismatch");
    assert(accepted.bid.id === replacedBid.id, "accepted bid id mismatch");
    assert(accepted.product.status === "reserved", "product should be reserved after accept");
    assert(accepted.product.reservedBy === "buyer-1", "product should be reserved for the winning buyer");
    assert(typeof accepted.product.reservedUntil === "string", "reservedUntil should be set");
    assert(accepted.product.reservedAmount === 46000, "product should store the accepted bid amount");
    assert(accepted.checkout.buyerId === "buyer-1", "checkout buyer mismatch");
    assert(accepted.checkout.amount === 46000, "checkout amount should be the accepted bid");
    assert(accepted.checkout.productId === biddingProductId, "checkout product mismatch");

    const afterAcceptAll = await app.request(`/products/${biddingProductId}/bids/all`, bearer(sellerToken), env);
    const afterAcceptBody = (await afterAcceptAll.json()) as { bids: unknown[] };
    assert(afterAcceptBody.bids.length === 0, "no active bids should remain after accept");

    const acceptNonSeller = await app.request(`/bids/${buyerBidId}/accept`, authedPost(buyerToken), env);
    assert(acceptNonSeller.status === 403, `expected 403 for non-seller accept, got ${acceptNonSeller.status}`);

    const acceptNotActive = await app.request(`/bids/${buyerBidId}/accept`, authedPost(sellerToken), env);
    assert(acceptNotActive.status === 409, `expected 409 for re-accepting non-active bid, got ${acceptNotActive.status}`);

    // 11. Direct buy: reserve on a non-bidding product.
    const reserveOnBidding = await app.request(`/products/${biddingProductId}/reserve`, authedPost(buyerToken), env);
    assert(reserveOnBidding.status === 400, `expected 400 for reserve on bidding product, got ${reserveOnBidding.status}`);

    const reserveSelf = await app.request(`/products/${nonBiddingProductId}/reserve`, authedPost(sellerToken), env);
    assert(reserveSelf.status === 400, `expected 400 for reserving own product, got ${reserveSelf.status}`);

    const reserveRes = await app.request(`/products/${nonBiddingProductId}/reserve`, authedPost(buyerToken), env);
    assert(reserveRes.status === 200, `expected 200 on reserve, got ${reserveRes.status}`);
    const reserved = (await reserveRes.json()) as {
      product: Product & { id: string };
      checkout: { productId: string; buyerId: string; amount: number; currency: string };
    };
    assert(reserved.product.status === "reserved", "product should be reserved");
    assert(reserved.product.reservedBy === "buyer-1", "reservedBy mismatch");
    assert(new Date(reserved.product.reservedUntil!).getTime() > Date.now(), "reservedUntil should be in the future");
    assert(reserved.product.reservedAmount === 50000, "direct-buy reserve should store the list price");
    assert(reserved.checkout.amount === 50000, "checkout amount should be the price");

    const reserveTaken = await app.request(`/products/${nonBiddingProductId}/reserve`, authedPost(buyer2Token), env);
    assert(reserveTaken.status === 409, `expected 409 when already reserved, got ${reserveTaken.status}`);

    const reserveIdempotent = await app.request(`/products/${nonBiddingProductId}/reserve`, authedPost(buyerToken), env);
    assert(reserveIdempotent.status === 200, `expected idempotent 200 for same buyer, got ${reserveIdempotent.status}`);

    // 12. Check-on-read expiry: backdate the hold, then the feed reverts it.
    await db.updateDoc<Product>(`${collections.products}/${nonBiddingProductId}`, {
      reservedUntil: new Date(Date.now() - 1000).toISOString(),
    });
    const detailAfterExpiry = await app.request(`/products/${nonBiddingProductId}`, {}, env);
    const expiryBody = (await detailAfterExpiry.json()) as { product: Product & { id: string } };
    assert(expiryBody.product.status === "active", `reservation should expire, got ${expiryBody.product.status}`);
    assert(expiryBody.product.reservedBy === null, "reservedBy should clear on expiry");
    assert(expiryBody.product.reservedAmount === null, "reservedAmount should clear on expiry");

    // 13. GET /products/mine — seller sees all statuses.
    const mineListings = await app.request("/products/mine", bearer(sellerToken), env);
    assert(mineListings.status === 200, `expected 200 for products/mine, got ${mineListings.status}`);
    const listings = (await mineListings.json()) as { products: Array<Product & { id: string }> };
    assert(listings.products.length === 2, `expected 2 seller listings, got ${listings.products.length}`);
    const statuses = new Set(listings.products.map((p) => p.status));
    assert(statuses.has("active") && statuses.has("reserved"), "seller listings should include active + reserved");

    // 14. GET /bids/mine — buyer's bids across products with product info.
    const myBids = await app.request("/bids/mine", bearer(buyerToken), env);
    assert(myBids.status === 200, `expected 200 for bids/mine, got ${myBids.status}`);
    const myBidsBody = (await myBids.json()) as {
      bids: Array<{ id: string; status: string; amount: number; product: { id: string; title: string; status: string } | null }>;
    };
    const mineById = new Map(myBidsBody.bids.map((b) => [b.id, b]));
    assert(mineById.has(replacedBid.id), "buyer should see their accepted bid");
    assert(mineById.get(replacedBid.id)!.status === "accepted", "accepted bid should show as accepted");
    assert(mineById.get(replacedBid.id)!.product?.title === "Bid test item", "bid product info missing");
    const hasWithdrawn = [...mineById.values()].some((b) => b.status === "withdrawn");
    assert(hasWithdrawn, "withdrawn bid should appear in my-bids");

    console.log(
      "BID TESTS PASSED (place/update/withdraw, public summary anonymity, seller view + accept -> reserve, direct buy reserve, expiry reversion, my-listings, my-bids)",
    );
  } finally {
    jwksServer.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
