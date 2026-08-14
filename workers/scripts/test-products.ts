// End-to-end route tests for the product + upload + media endpoints.
//
// Combines the patterns from test-auth.ts (mock JWKS + minted RS256 tokens)
// and test-firestore.ts (in-memory Firestore REST mock) so the real Hono app
// runs against fully fake dependencies.
//
// Run with: npm run test:products

import { createServer } from "node:http";

import app from "../src/index";
import { FirestoreClient, type FirestoreDocument, type FirestoreField } from "../src/lib/firestore";
import { collections, type Product, type User } from "../src/models";

const PROJECT_ID = "marketloop-rw";
const JWKS_PORT = 8799;
const JWKS_URL = `http://127.0.0.1:${JWKS_PORT}/jwks`;
const KID = "test-kid-2";
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
            compositeFilter?: {
              filters: Array<{
                fieldFilter: { field: { fieldPath: string }; op?: string; value: FirestoreField };
              }>;
            };
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
        const ff = q.where.fieldFilter as { field: { fieldPath: string }; op?: string; value: FirestoreField };
        filters.push({ fieldPath: ff.field.fieldPath, op: ff.op ?? "EQUAL", value: ff.value });
      }
      if ("compositeFilter" in q.where && q.where.compositeFilter) {
        for (const f of q.where.compositeFilter.filters) {
          filters.push({
            fieldPath: f.fieldFilter.field.fieldPath,
            op: f.fieldFilter.op ?? "EQUAL",
            value: f.fieldFilter.value,
          });
        }
      }
    }
    let entries = [...store.entries()].filter(([key]) => key.startsWith(`${collectionId}/`));
    for (const { fieldPath, op, value } of filters) {
      const want = decodeValue(value) as unknown;
      entries = entries.filter(([, doc]) => {
        const got = decodeValue(doc.fields[fieldPath]!) as unknown;
        switch (op) {
          case "EQUAL":
            return JSON.stringify(got) === JSON.stringify(want);
          case "NOT_EQUAL":
            return JSON.stringify(got) !== JSON.stringify(want);
          case "LESS_THAN":
            return typeof got === "number" && typeof want === "number" && got < want;
          case "LESS_THAN_OR_EQUAL":
            return typeof got === "number" && typeof want === "number" && got <= want;
          case "GREATER_THAN":
            return typeof got === "number" && typeof want === "number" && got > want;
          case "GREATER_THAN_OR_EQUAL":
            return typeof got === "number" && typeof want === "number" && got >= want;
          case "ARRAY_CONTAINS":
            return Array.isArray(got) && Array.isArray(want) && got.some((g) => JSON.stringify(g) === JSON.stringify(want[0]));
          case "ARRAY_CONTAINS_ANY": {
            if (!Array.isArray(got) || !Array.isArray(want)) return false;
            return want.some((w) => got.some((g) => JSON.stringify(g) === JSON.stringify(w)));
          }
          case "IN":
            return Array.isArray(want) && want.some((w) => JSON.stringify(w) === JSON.stringify(got));
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

// ---- R2 binding stub --------------------------------------------------------

const mediaStore = new Map<string, string>();
const fakeImages: R2Bucket = {
  get: async (key: string) => {
    const contentType = mediaStore.get(key);
    if (!contentType) return null;
    return {
      key,
      version: "1",
      size: 0,
      etag: "etag-1",
      httpEtag: "etag-1",
      uploaded: new Date(0),
      httpMetadata: { contentType },
      customMetadata: {},
      range: null,
      checksums: {},
      body: new ReadableStream({ start(controller) { controller.close(); } }),
      writeHttpMetadata(headers: Headers) {
        headers.set("Content-Type", contentType);
      },
    } as unknown as R2Object;
  },
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

async function createListing(
  env: Record<string, unknown>,
  sellerToken: string,
  body: {
    title: string;
    category?: string;
    priceAmount: number;
    priceCurrency?: "RWF" | "USD";
    isBiddingEnabled?: boolean;
  },
): Promise<Product & { id: string }> {
  const res = await app.request(
    "/products",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: body.title,
        description: `Description for ${body.title}.`,
        category: body.category ?? "Electronics",
        priceAmount: body.priceAmount,
        priceCurrency: body.priceCurrency ?? "RWF",
        isNegotiable: false,
        isBiddingEnabled: body.isBiddingEnabled ?? false,
        conditionNote: "used",
        images: ["uploads/seller-1/test.jpg"],
        videoUrl: null,
        deliveryFee: 0,
        deliveryFeePayer: "seller",
      }),
    },
    env,
  );
  if (res.status !== 201) {
    const body = await res.text();
    assert(false, `createListing failed (${res.status}): ${body}`);
  }
  return ((await res.json()) as { product: Product & { id: string } }).product;
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
      sub: "seller-1",
      name: "Test Seller",
      email: "seller@example.com",
      picture: "https://example.com/s.png",
      auth_time: now - 60,
      iat: now - 60,
      exp: now + 3600,
    };
    const sellerToken = await mintToken(claims, privateKey);
    const buyerToken = await mintToken({ ...claims, sub: "buyer-1", name: "Buyer" }, privateKey);

    // Seed the seller's user doc so the detail page can join public info.
    const db = new FirestoreClient({
      projectId: PROJECT_ID,
      clientEmail: "test@example.com",
      privateKey: "test-key",
      apiUrl: API_URL,
      accessTokenProvider: async () => "test-access-token",
    });
    await db.createDoc<User>(collections.users, "seller-1", {
      uid: "seller-1",
      name: "Test Seller",
      email: "seller@example.com",
      photoUrl: "https://example.com/s.png",
      phone: "+250700000000",
      walletBalance: 0,
      createdAt: new Date(now * 1000).toISOString(),
      rating: null,
    });

    // 1. POST /products requires auth.
    const noAuth = await app.request("/products", { method: "POST", body: JSON.stringify({}) }, env);
    assert(noAuth.status === 401, `expected 401 without token, got ${noAuth.status}`);

    // 2. Create a product.
    const imageKey = "uploads/seller-1/11111111-1111-1111-1111-111111111111.jpg";
    const createRes = await app.request(
      "/products",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "iPhone 12",
          description: "Gently used iPhone 12.",
          category: "Phones & Tablets",
          priceAmount: 350000,
          priceCurrency: "RWF",
          isNegotiable: true,
          isBiddingEnabled: false,
          conditionNote: "used 6 months",
          images: [imageKey],
          videoUrl: null,
          deliveryFee: 2000,
          deliveryFeePayer: "buyer",
        }),
      },
      env,
    );
    assert(createRes.status === 201, `expected 201, got ${createRes.status}`);
    const created = (await createRes.json()) as { product: Product & { id: string } };
    assert(created.product.sellerId === "seller-1", "sellerId mismatch");
    assert(created.product.status === "active", "status should default to active");
    assert(created.product.images[0] === imageKey, "images not persisted");
    const productId = created.product.id;
    assert(typeof productId === "string" && productId.length > 0, "product should have an auto id");

    // 3. Validation failures.
    const badCategory = await app.request(
      "/products",
      { method: "POST", headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: "x", category: "Nope", priceAmount: 100, priceCurrency: "RWF", images: [imageKey] }) },
      env,
    );
    assert(badCategory.status === 400, `expected 400 for bad category, got ${badCategory.status}`);

    const noImages = await app.request(
      "/products",
      { method: "POST", headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: "x", category: "Other", priceAmount: 100, priceCurrency: "RWF", images: [] }) },
      env,
    );
    assert(noImages.status === 400, `expected 400 for empty images, got ${noImages.status}`);

    const zeroPrice = await app.request(
      "/products",
      { method: "POST", headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: "x", category: "Other", priceAmount: 0, priceCurrency: "RWF", images: [imageKey] }) },
      env,
    );
    assert(zeroPrice.status === 400, `expected 400 for zero price, got ${zeroPrice.status}`);

    // 4. Public feed.
    const feed = await app.request("/products", {}, env);
    assert(feed.status === 200, `expected 200 for feed, got ${feed.status}`);
    const feedBody = (await feed.json()) as { products: Array<Product & { id: string }>; page: number; pageSize: number; hasMore: boolean };
    assert(feedBody.products.length === 1, `expected 1 product in feed, got ${feedBody.products.length}`);
    assert(feedBody.page === 1 && feedBody.pageSize === 20, "pagination defaults wrong");
    assert(feedBody.hasMore === false, "hasMore should be false with 1 product");

    const filtered = await app.request("/products?category=Phones%20%26%20Tablets&currency=RWF", {}, env);
    const filteredBody = (await filtered.json()) as { products: Array<Product & { id: string }> };
    assert(filteredBody.products.length === 1, "filtered feed should return the product");

    const filteredEmpty = await app.request("/products?category=Fashion", {}, env);
    const filteredEmptyBody = (await filteredEmpty.json()) as { products: Array<Product & { id: string }> };
    assert(filteredEmptyBody.products.length === 0, "Fashion feed should be empty");

    // 5. Product detail with seller public info (no email / phone).
    const detail = await app.request(`/products/${productId}`, {}, env);
    assert(detail.status === 200, `expected 200 for detail, got ${detail.status}`);
    const detailBody = (await detail.json()) as { product: Product; seller: { uid: string; name: string; photoUrl: string | null } };
    assert(detailBody.product.title === "iPhone 12", "detail product mismatch");
    assert(detailBody.seller.uid === "seller-1", "seller uid mismatch");
    assert(detailBody.seller.name === "Test Seller", "seller name mismatch");
    assert(detailBody.seller.photoUrl === "https://example.com/s.png", "seller photo mismatch");
    assert(!("email" in detailBody.seller) && !("phone" in detailBody.seller), "seller email/phone leaked");

    const missingDetail = await app.request("/products/nope", {}, env);
    assert(missingDetail.status === 404, `expected 404 for missing product, got ${missingDetail.status}`);

    // 6. PATCH: seller-only.
    const buyerPatch = await app.request(
      `/products/${productId}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${buyerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ priceAmount: 1 }) },
      env,
    );
    assert(buyerPatch.status === 403, `expected 403 for non-seller patch, got ${buyerPatch.status}`);

    const sellerPatch = await app.request(
      `/products/${productId}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ priceAmount: 400000, isNegotiable: false }) },
      env,
    );
    assert(sellerPatch.status === 200, `expected 200 for seller patch, got ${sellerPatch.status}`);
    const patched = (await sellerPatch.json()) as { product: Product };
    assert(patched.product.priceAmount === 400000, "price not updated");
    assert(patched.product.isNegotiable === false, "isNegotiable not updated");
    assert(patched.product.title === "iPhone 12", "unrelated fields should not change");

    const invalidPatch = await app.request(
      `/products/${productId}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ priceCurrency: "EUR" }) },
      env,
    );
    assert(invalidPatch.status === 400, `expected 400 for invalid patch, got ${invalidPatch.status}`);

    // 7. Mark removed -> detail 404, feed hides it.
    const removeRes = await app.request(
      `/products/${productId}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "removed" }) },
      env,
    );
    assert(removeRes.status === 200, `expected 200 for removal, got ${removeRes.status}`);
    const removedDetail = await app.request(`/products/${productId}`, {}, env);
    assert(removedDetail.status === 404, `expected 404 for removed product, got ${removedDetail.status}`);
    const feedAfter = await app.request("/products", {}, env);
    const feedAfterBody = (await feedAfter.json()) as { products: Array<Product & { id: string }> };
    assert(feedAfterBody.products.length === 0, "removed product should not appear in feed");

    // 7b. Search (titleKeywords via array-contains-any) + price range + sort.
    const phone12Mini = await createListing(env, sellerToken, {
      title: "iPhone 12 Mini",
      category: "Phones & Tablets",
      priceAmount: 400000,
    });
    const phone13Pro = await createListing(env, sellerToken, {
      title: "iPhone 13 Pro",
      category: "Phones & Tablets",
      priceAmount: 1200000,
    });
    const galaxy = await createListing(env, sellerToken, {
      title: "Samsung Galaxy S21",
      priceAmount: 800000,
    });

    const searchRes = await app.request("/products?search=iphone", {}, env);
    assert(searchRes.status === 200, `search should be 200, got ${searchRes.status}`);
    let searchBody = (await searchRes.json()) as { products: Array<Product & { id: string }> };
    const searchTitles = searchBody.products.map((p) => p.title).sort();
    assert(
      JSON.stringify(searchTitles) === JSON.stringify(["iPhone 12 Mini", "iPhone 13 Pro"]),
      `search=iphone should match the two iPhones, got ${JSON.stringify(searchTitles)}`,
    );

    const galaxySearch = await app.request("/products?search=galaxy", {}, env);
    const galaxyBody = (await galaxySearch.json()) as { products: Array<Product & { id: string }> };
    assert(galaxyBody.products.length === 1 && galaxyBody.products[0]!.title === "Samsung Galaxy S21", "search=galaxy should match only the S21");

    const noneSearch = await app.request("/products?search=zzzmissing", {}, env);
    const noneBody = (await noneSearch.json()) as { products: Array<Product & { id: string }> };
    assert(noneBody.products.length === 0, "search for a missing keyword should return nothing");

    const phoneCased = await app.request("/products?search=IPHONE%2013", {}, env);
    const phoneCasedBody = (await phoneCased.json()) as { products: Array<Product & { id: string }> };
    assert(phoneCasedBody.products.length === 2, "search should be case-insensitive with multi-word terms");

    // priceMin / priceMax.
    const minOnly = await app.request("/products?priceMin=900000", {}, env);
    const minBody = (await minOnly.json()) as { products: Array<Product & { id: string }> };
    assert(minBody.products.length === 1 && minBody.products[0]!.title === "iPhone 13 Pro", "priceMin=900000 should leave only the 1.2M phone");

    const maxOnly = await app.request("/products?priceMax=700000", {}, env);
    const maxBody = (await maxOnly.json()) as { products: Array<Product & { id: string }> };
    assert(maxBody.products.length === 1 && maxBody.products[0]!.title === "iPhone 12 Mini", "priceMax=700000 should leave only the 400k phone");

    const range = await app.request("/products?priceMin=400000&priceMax=1000000", {}, env);
    const rangeBody = (await range.json()) as { products: Array<Product & { id: string }> };
    assert(rangeBody.products.length === 2, "range 400k-1M should match the Mini and the S21");

    const badPrice = await app.request("/products?priceMin=abc", {}, env);
    assert(badPrice.status === 400, `priceMin=abc should be 400, got ${badPrice.status}`);

    const badOrder = await app.request("/products?priceMin=500&priceMax=100", {}, env);
    assert(badOrder.status === 400, `priceMin>priceMax should be 400, got ${badOrder.status}`);

    // sortBy.
    const asc = await app.request("/products?sortBy=price_asc", {}, env);
    const ascBody = (await asc.json()) as { products: Array<Product & { id: string }> };
    assert(
      JSON.stringify(ascBody.products.map((p) => p.title)) ===
        JSON.stringify(["iPhone 12 Mini", "Samsung Galaxy S21", "iPhone 13 Pro"]),
      `price_asc ordering wrong: ${JSON.stringify(ascBody.products.map((p) => p.title))}`,
    );

    const desc = await app.request("/products?sortBy=price_desc", {}, env);
    const descBody = (await desc.json()) as { products: Array<Product & { id: string }> };
    assert(
      JSON.stringify(descBody.products.map((p) => p.title)) ===
        JSON.stringify(["iPhone 13 Pro", "Samsung Galaxy S21", "iPhone 12 Mini"]),
      `price_desc ordering wrong: ${JSON.stringify(descBody.products.map((p) => p.title))}`,
    );

    const badSort = await app.request("/products?sortBy=foo", {}, env);
    assert(badSort.status === 400, `sortBy=foo should be 400, got ${badSort.status}`);

    // Combined filters.
    const combo = await app.request("/products?search=iphone&category=Electronics", {}, env);
    const comboBody = (await combo.json()) as { products: Array<Product & { id: string }> };
    assert(comboBody.products.length === 0, "search+category combo should be empty");

    // Title patch recomputes keywords.
    const rename = await app.request(
      `/products/${phone13Pro.id}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: "iPhone 14 Pro Max" }) },
      env,
    );
    assert(rename.status === 200, `rename should be 200, got ${rename.status}`);
    const renamedSearch = await app.request("/products?search=14", {}, env);
    const renamedBody = (await renamedSearch.json()) as { products: Array<Product & { id: string }> };
    assert(renamedBody.products.length === 1 && renamedBody.products[0]!.title === "iPhone 14 Pro Max", "renamed product should match new title keyword");

    // Cleanup: hide the extra products.
    for (const product of [phone12Mini, phone13Pro, galaxy]) {
      const rm = await app.request(
        `/products/${product.id}`,
        { method: "PATCH", headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "removed" }) },
        env,
      );
      assert(rm.status === 200, `cleanup removal failed for ${product.id}`);
    }

    // 8. Presign: auth required.
    const presignNoAuth = await app.request("/uploads/presign", { method: "POST", body: JSON.stringify({ files: [] }) }, env);
    assert(presignNoAuth.status === 401, `expected 401 for presign without token, got ${presignNoAuth.status}`);

    // 9. Presign: valid batch.
    const presignRes = await app.request(
      "/uploads/presign",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          files: [
            { contentType: "image/jpeg", size: 1024 },
            { contentType: "image/png", size: 2048 },
            { contentType: "video/mp4", size: 10 * 1024 * 1024 },
          ],
        }),
      },
      env,
    );
    assert(presignRes.status === 200, `expected 200 for presign, got ${presignRes.status}`);
    const presignBody = (await presignRes.json()) as {
      uploads: Array<{ key: string; contentType: string; url: string; expiresInSeconds: number }>;
    };
    assert(presignBody.uploads.length === 3, `expected 3 uploads, got ${presignBody.uploads.length}`);
    for (const upload of presignBody.uploads) {
      assert(upload.key.startsWith("uploads/seller-1/"), `key should be user-scoped: ${upload.key}`);
      const url = new URL(upload.url);
      assert(url.host === "test-account.r2.cloudflarestorage.com", `unexpected presign host: ${url.host}`);
      assert(url.searchParams.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256", "missing X-Amz-Algorithm");
      assert(/^[0-9a-f]{64}$/.test(url.searchParams.get("X-Amz-Signature") ?? ""), "missing signature");
      assert(url.searchParams.get("X-Amz-Expires") === "900", "expected 900s expiry");
    }

    // 10. Presign: validation failures.
    const badMime = await app.request(
      "/uploads/presign",
      { method: "POST", headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ files: [{ contentType: "text/html", size: 10 }] }) },
      env,
    );
    assert(badMime.status === 400, `expected 400 for bad mime, got ${badMime.status}`);

    const tooBig = await app.request(
      "/uploads/presign",
      { method: "POST", headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ files: [{ contentType: "image/jpeg", size: 6 * 1024 * 1024 }] }) },
      env,
    );
    assert(tooBig.status === 400, `expected 400 for oversized image, got ${tooBig.status}`);

    const tooMany = await app.request(
      "/uploads/presign",
      { method: "POST", headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ files: Array.from({ length: 7 }, () => ({ contentType: "image/jpeg", size: 10 })) }) },
      env,
    );
    assert(tooMany.status === 400, `expected 400 for >6 images, got ${tooMany.status}`);

    // 11. Presign without R2 creds -> 503.
    const noCreds = await app.request(
      "/uploads/presign",
      { method: "POST", headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ files: [{ contentType: "image/jpeg", size: 10 }] }) },
      { ...env, R2_ACCOUNT_ID: undefined },
    );
    assert(noCreds.status === 503, `expected 503 without R2 creds, got ${noCreds.status}`);

    // 12. Media serving.
    const mediaKey = "uploads/seller-1/22222222-2222-2222-2222-222222222222.jpg";
    mediaStore.set(mediaKey, "image/jpeg");
    const mediaRes = await app.request(`/media/${mediaKey}`, {}, env);
    assert(mediaRes.status === 200, `expected 200 for media, got ${mediaRes.status}`);
    assert(mediaRes.headers.get("Content-Type") === "image/jpeg", "media content-type mismatch");
    assert(mediaRes.headers.get("Cache-Control")?.includes("immutable"), "media should be cached as immutable");

    const mediaMissing = await app.request("/media/nope.jpg", {}, env);
    assert(mediaMissing.status === 404, `expected 404 for missing media, got ${mediaMissing.status}`);

    console.log(
      "PRODUCT TESTS PASSED (auth on create/presign, validation, public feed + filters, detail with seller info, seller-only patch, removed hides, presign batch + limits, media serving)",
    );
  } finally {
    jwksServer.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
