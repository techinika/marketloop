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

const PROJECT_ID = "handi-rw";
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
    const documentId = url.searchParams.get("documentId") ?? `auto-${String(++autoCounter).padStart(8, "0")}`;
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
  artisanToken: string,
  body: {
    title: string;
    category?: string;
    priceAmount: number;
    priceCurrency?: "RWF" | "USD";
    isBiddingEnabled?: boolean;
    productType?: "made_to_order" | "ready_to_ship";
    quantityAvailable?: number;
    tags?: string[];
    materials?: string[];
    region?: string;
    maxConcurrentOrders?: number | null;
    acceptingOrders?: boolean;
    isCustomizable?: boolean;
  },
): Promise<Product & { id: string }> {
  const isRts = (body.productType ?? "made_to_order") === "ready_to_ship";
  const res = await app.request(
    "/products",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: body.title,
        description: `Description for ${body.title}.`,
        category: body.category ?? "Pottery",
        priceAmount: body.priceAmount,
        priceCurrency: body.priceCurrency ?? "RWF",
        isNegotiable: false,
        isBiddingEnabled: body.isBiddingEnabled ?? false,
        conditionNote: "used",
        images: ["uploads/artisan-1/test.jpg"],
        videoUrl: null,
        deliveryFee: 0,
        deliveryFeePayer: "artisan",
        productType: body.productType ?? "made_to_order",
        tags: body.tags ?? [],
        materials: body.materials ?? [],
        region: body.region ?? null,
        ...(isRts
          ? { quantityAvailable: body.quantityAvailable ?? 1 }
          : {
              productionTimeDays: 7,
              acceptingOrders: body.acceptingOrders ?? true,
              maxConcurrentOrders: body.maxConcurrentOrders ?? null,
              isCustomizable: body.isCustomizable ?? false,
            }),
      }),
    },
    env,
  );
  if (res.status !== 201) {
    const bodyText = await res.text();
    assert(false, `createListing failed (${res.status}): ${bodyText}`);
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
      R2_BUCKET_NAME: "handi-assets",
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
      sub: "artisan-1",
      name: "Test Artisan",
      email: "artisan@example.com",
      picture: "https://example.com/s.png",
      auth_time: now - 60,
      iat: now - 60,
      exp: now + 3600,
    };
    const artisanToken = await mintToken(claims, privateKey);
    const buyerToken = await mintToken({ ...claims, sub: "buyer-1", name: "Buyer" }, privateKey);

    // Seed the artisan's user doc so the detail page can join public info.
    const db = new FirestoreClient({
      projectId: PROJECT_ID,
      clientEmail: "test@example.com",
      privateKey: "test-key",
      apiUrl: API_URL,
      accessTokenProvider: async () => "test-access-token",
    });
    await db.createDoc<User>(collections.users, "artisan-1", {
      uid: "artisan-1",
      name: "Test Artisan",
      email: "artisan@example.com",
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
    const imageKey = "uploads/artisan-1/11111111-1111-1111-1111-111111111111.jpg";
    const createRes = await app.request(
      "/products",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "iPhone 12",
          description: "Gently used iPhone 12.",
          category: "Textiles & Batik",
          priceAmount: 350000,
          priceCurrency: "RWF",
          isNegotiable: true,
          isBiddingEnabled: false,
          conditionNote: "used 6 months",
          images: [imageKey],
          videoUrl: null,
          deliveryFee: 2000,
          deliveryFeePayer: "buyer",
          productType: "made_to_order",
          tags: ["smartphone", "refurbished"],
          materials: [],
          region: "Kigali",
          productionTimeDays: 7,
        }),
      },
      env,
    );
    assert(createRes.status === 201, `expected 201, got ${createRes.status}`);
    const created = (await createRes.json()) as { product: Product & { id: string } };
    assert(created.product.artisanId === "artisan-1", "artisanId mismatch");
    assert(created.product.status === "active", "status should default to active");
    assert(created.product.images[0] === imageKey, "images not persisted");
    assert(created.product.productType === "made_to_order", "productType not persisted");
    assert(
      JSON.stringify(created.product.tags) === JSON.stringify(["smartphone", "refurbished"]),
      "tags not persisted",
    );
    assert(created.product.region === "Kigali", "region not persisted");
    const productId = created.product.id;
    assert(typeof productId === "string" && productId.length > 0, "product should have an auto id");

    // 3. Validation failures.
    const missingType = await app.request(
      "/products",
      { method: "POST", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: "x", description: "d", category: "Pottery", priceAmount: 100, priceCurrency: "RWF", images: [imageKey], productionTimeDays: 7 }) },
      env,
    );
    assert(missingType.status === 400, `expected 400 for missing productType, got ${missingType.status}`);

    const badCategory = await app.request(
      "/products",
      { method: "POST", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" },      body: JSON.stringify({ title: "x", description: "d", category: "Nope", priceAmount: 100, priceCurrency: "RWF", images: [imageKey], productType: "made_to_order", productionTimeDays: 7 }) },
      env,
    );
    assert(badCategory.status === 400, `expected 400 for bad category, got ${badCategory.status}`);

    const noImages = await app.request(
      "/products",
      { method: "POST", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" },      body: JSON.stringify({ title: "x", description: "d", category: "Other Handmade", priceAmount: 100, priceCurrency: "RWF", images: [], productType: "made_to_order", productionTimeDays: 7 }) },
      env,
    );
    assert(noImages.status === 400, `expected 400 for empty images, got ${noImages.status}`);

    const zeroPrice = await app.request(
      "/products",
      { method: "POST", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" },      body: JSON.stringify({ title: "x", description: "d", category: "Other Handmade", priceAmount: 0, priceCurrency: "RWF", images: [imageKey], productType: "made_to_order", productionTimeDays: 7 }) },
      env,
    );
    assert(zeroPrice.status === 400, `expected 400 for zero price, got ${zeroPrice.status}`);

    const rtsWithBidding = await app.request(
      "/products",
      { method: "POST", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" },      body: JSON.stringify({ title: "x", description: "d", category: "Other Handmade", priceAmount: 100, priceCurrency: "RWF", images: [imageKey], productType: "ready_to_ship", quantityAvailable: 1, isBiddingEnabled: true }) },
      env,
    );
    assert(rtsWithBidding.status === 400, `expected 400 for RTS + bidding, got ${rtsWithBidding.status}`);

    const rtsWithProductionDays = await app.request(
      "/products",
      { method: "POST", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" },      body: JSON.stringify({ title: "x", description: "d", category: "Other Handmade", priceAmount: 100, priceCurrency: "RWF", images: [imageKey], productType: "ready_to_ship", quantityAvailable: 1, productionTimeDays: 14 }) },
      env,
    );
    assert(rtsWithProductionDays.status === 400, `expected 400 for RTS + productionTimeDays, got ${rtsWithProductionDays.status}`);

    // 4. Public feed.
    const feed = await app.request("/products", {}, env);
    assert(feed.status === 200, `expected 200 for feed, got ${feed.status}`);
    const feedBody = (await feed.json()) as { products: Array<Product & { id: string }>; page: number; pageSize: number; hasMore: boolean };
    assert(feedBody.products.length === 1, `expected 1 product in feed, got ${feedBody.products.length}`);
    assert(feedBody.page === 1 && feedBody.pageSize === 20, "pagination defaults wrong");
    assert(feedBody.hasMore === false, "hasMore should be false with 1 product");

    const filtered = await app.request("/products?category=Textiles%20%26%20Batik&currency=RWF", {}, env);
    const filteredBody = (await filtered.json()) as { products: Array<Product & { id: string }> };
    assert(filteredBody.products.length === 1, "filtered feed should return the product");

    const filteredEmpty = await app.request("/products?category=Paintings", {}, env);
    const filteredEmptyBody = (await filteredEmpty.json()) as { products: Array<Product & { id: string }> };
    assert(filteredEmptyBody.products.length === 0, "Paintings feed should be empty");

    // 5. Product detail with artisan public info (no email / phone).
    const detail = await app.request(`/products/${productId}`, {}, env);
    assert(detail.status === 200, `expected 200 for detail, got ${detail.status}`);
    const detailBody = (await detail.json()) as { product: Product; artisan: { uid: string; name: string; photoUrl: string | null } };
    assert(detailBody.product.title === "iPhone 12", "detail product mismatch");
    assert(detailBody.artisan.uid === "artisan-1", "artisan uid mismatch");
    assert(detailBody.artisan.name === "Test Artisan", "artisan name mismatch");
    assert(detailBody.artisan.photoUrl === "https://example.com/s.png", "artisan photo mismatch");
    assert(!("email" in detailBody.artisan) && !("phone" in detailBody.artisan), "artisan email/phone leaked");

    const missingDetail = await app.request("/products/nope", {}, env);
    assert(missingDetail.status === 404, `expected 404 for missing product, got ${missingDetail.status}`);

    // 6. PATCH: artisan-only.
    const buyerPatch = await app.request(
      `/products/${productId}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${buyerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ priceAmount: 1 }) },
      env,
    );
    assert(buyerPatch.status === 403, `expected 403 for non-artisan patch, got ${buyerPatch.status}`);

    const artisanPatch = await app.request(
      `/products/${productId}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ priceAmount: 400000, isNegotiable: false }) },
      env,
    );
    assert(artisanPatch.status === 200, `expected 200 for artisan patch, got ${artisanPatch.status}`);
    const patched = (await artisanPatch.json()) as { product: Product };
    assert(patched.product.priceAmount === 400000, "price not updated");
    assert(patched.product.isNegotiable === false, "isNegotiable not updated");
    assert(patched.product.title === "iPhone 12", "unrelated fields should not change");

    const invalidPatch = await app.request(
      `/products/${productId}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ priceCurrency: "EUR" }) },
      env,
    );
    assert(invalidPatch.status === 400, `expected 400 for invalid patch, got ${invalidPatch.status}`);

    // 7. Mark removed -> detail 404, feed hides it.
    const removeRes = await app.request(
      `/products/${productId}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "removed" }) },
      env,
    );
    assert(removeRes.status === 200, `expected 200 for removal, got ${removeRes.status}`);
    const removedDetail = await app.request(`/products/${productId}`, {}, env);
    assert(removedDetail.status === 404, `expected 404 for removed product, got ${removedDetail.status}`);
    const feedAfter = await app.request("/products", {}, env);
    const feedAfterBody = (await feedAfter.json()) as { products: Array<Product & { id: string }> };
    assert(feedAfterBody.products.length === 0, "removed product should not appear in feed");

    // 7b. Search (titleKeywords via array-contains-any) + price range + sort.
    const phone12Mini = await createListing(env, artisanToken, {
      title: "iPhone 12 Mini",
      category: "Textiles & Batik",
      priceAmount: 400000,
    });
    const phone13Pro = await createListing(env, artisanToken, {
      title: "iPhone 13 Pro",
      category: "Textiles & Batik",
      priceAmount: 1200000,
    });
    const galaxy = await createListing(env, artisanToken, {
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
    const combo = await app.request("/products?search=iphone&category=Pottery", {}, env);
    const comboBody = (await combo.json()) as { products: Array<Product & { id: string }> };
    assert(comboBody.products.length === 0, "search+category combo should be empty");

    // Title patch recomputes keywords.
    const rename = await app.request(
      `/products/${phone13Pro.id}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: "iPhone 14 Pro Max" }) },
      env,
    );
    assert(rename.status === 200, `rename should be 200, got ${rename.status}`);
    const renamedSearch = await app.request("/products?search=14", {}, env);
    const renamedBody = (await renamedSearch.json()) as { products: Array<Product & { id: string }> };
    assert(renamedBody.products.length === 1 && renamedBody.products[0]!.title === "iPhone 14 Pro Max", "renamed product should match new title keyword");

    // 7c. Ready-to-ship listings: per-type fields forced at creation.
    const basket = await createListing(env, artisanToken, {
      title: "Handwoven Sisal Basket",
      category: "Agaseke Baskets",
      priceAmount: 25000,
      productType: "ready_to_ship",
      quantityAvailable: 3,
      tags: ["sisal", "handwoven"],
      materials: ["Sisal Fiber"],
      region: "Eastern Province",
    });
    assert(basket.productType === "ready_to_ship", "RTS productType missing");
    assert(basket.quantityAvailable === 3, "RTS stock not persisted");
    assert(basket.productionTimeDays === 0, "RTS should force productionTimeDays 0");
    assert(basket.customizationOptions.length === 0, "RTS should force empty customizationOptions");
    assert(basket.allowsReferenceUpload === false, "RTS should force allowsReferenceUpload false");

    // 7d. Feed filters: by type, tags, materials, region.
    const rtsFilter = await app.request("/products?productType=ready_to_ship", {}, env);
    const rtsFilterBody = (await rtsFilter.json()) as { products: Array<Product & { id: string }> };
    assert(
      rtsFilterBody.products.length === 1 && rtsFilterBody.products[0]!.title === "Handwoven Sisal Basket",
      `productType=ready_to_ship should return only the basket, got ${JSON.stringify(rtsFilterBody.products.map((p) => p.title))}`,
    );

    const mtoFilter = await app.request("/products?productType=made_to_order", {}, env);
    const mtoFilterBody = (await mtoFilter.json()) as { products: Array<Product & { id: string }> };
    assert(
      mtoFilterBody.products.every((p) => p.productType !== "ready_to_ship") &&
        mtoFilterBody.products.length === 3,
      `productType=made_to_order should return only made-to-order, got ${JSON.stringify(mtoFilterBody.products.map((p) => p.title))}`,
    );

    const tagFilter = await app.request("/products?tags=sisal,handwoven", {}, env);
    const tagFilterBody = (await tagFilter.json()) as { products: Array<Product & { id: string }> };
    assert(tagFilterBody.products.length === 1 && tagFilterBody.products[0]!.title === "Handwoven Sisal Basket", "tags filter should match the basket");

    const materialFilter = await app.request("/products?materials=Sisal%20Fiber", {}, env);
    const materialFilterBody = (await materialFilter.json()) as { products: Array<Product & { id: string }> };
    assert(materialFilterBody.products.length === 1, "materials filter should match the basket");

    const regionFilter = await app.request("/products?region=Eastern%20Province", {}, env);
    const regionFilterBody = (await regionFilter.json()) as { products: Array<Product & { id: string }> };
    assert(regionFilterBody.products.length === 1, "region filter should match the basket");

    const badType = await app.request("/products?productType=foo", {}, env);
    assert(badType.status === 400, `productType=foo should be 400, got ${badType.status}`);

    // 7e. Per-type PATCH rules.
    const sellOut = await app.request(
      `/products/${basket.id}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "sold_out" }) },
      env,
    );
    assert(sellOut.status === 200, `RTS sold_out patch should be 200, got ${sellOut.status}`);
    const soldOutBody = (await sellOut.json()) as { product: Product };
    assert(soldOutBody.product.status === "sold_out", "RTS status not set to sold_out");

    const restock = await app.request(
      `/products/${basket.id}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ quantityAvailable: 5 }) },
      env,
    );
    assert(restock.status === 200, `RTS restock should be 200, got ${restock.status}`);
    const restocked = (await restock.json()) as { product: Product };
    assert(restocked.product.status === "active", "restock should flip sold_out back to active");
    assert(restocked.product.quantityAvailable === 5, "restock should update quantityAvailable");

    const rtsReserved = await app.request(
      `/products/${basket.id}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "reserved" }) },
      env,
    );
    assert(rtsReserved.status === 400, `RTS cannot be set reserved, got ${rtsReserved.status}`);

    const rtsProduction = await app.request(
      `/products/${basket.id}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ productionTimeDays: 3 }) },
      env,
    );
    assert(rtsProduction.status === 400, `RTS productionTimeDays patch should be 400, got ${rtsProduction.status}`);

    const rtsOptions = await app.request(
      `/products/${basket.id}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ customizationOptions: [{ id: "a", type: "text", label: "Note", required: false, priceAdjustment: 0 }] }) },
      env,
    );
    assert(rtsOptions.status === 400, `RTS customizationOptions patch should be 400, got ${rtsOptions.status}`);

    const mtoStock = await app.request(
      `/products/${phone12Mini.id}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ quantityAvailable: 2 }) },
      env,
    );
    assert(mtoStock.status === 400, `MTO quantityAvailable patch should be 400, got ${mtoStock.status}`);

    const mtoSoldOut = await app.request(
      `/products/${phone12Mini.id}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "sold_out" }) },
      env,
    );
    assert(mtoSoldOut.status === 400, `MTO sold_out patch should be 400, got ${mtoSoldOut.status}`);

    const typeChange = await app.request(
      `/products/${phone12Mini.id}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ productType: "ready_to_ship" }) },
      env,
    );
    assert(typeChange.status === 400, `productType cannot change, got ${typeChange.status}`);

    // 7f. MTO accepting-orders toggle: manual pause sticks, raising the cap doesn't reopen a paused listing.
    const necklace = await createListing(env, artisanToken, {
      title: "Commissioned Beaded Necklace",
      category: "Jewelry & Beadwork",
      priceAmount: 40000,
      productType: "made_to_order",
      maxConcurrentOrders: 2,
      acceptingOrders: true,
    });
    const pause = await app.request(
      `/products/${necklace.id}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ acceptingOrders: false }) },
      env,
    );
    assert(pause.status === 200, `pause should be 200, got ${pause.status}`);
    const paused = (await pause.json()) as { product: Product };
    assert(paused.product.acceptingOrders === false && paused.product.manuallyPaused === true, "pause should set manuallyPaused");

    const raiseCap = await app.request(
      `/products/${necklace.id}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ maxConcurrentOrders: 5 }) },
      env,
    );
    const raised = (await raiseCap.json()) as { product: Product };
    assert(raised.product.acceptingOrders === false, "manually paused listing should not auto-reopen");

    const reopen = await app.request(
      `/products/${necklace.id}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ acceptingOrders: true }) },
      env,
    );
    const reopened = (await reopen.json()) as { product: Product };
    assert(reopened.product.acceptingOrders === true && reopened.product.manuallyPaused === false, "explicit reopen should clear manuallyPaused");

    // 7g. Artisan storefront profile (PATCH /artisans/me) + public storefront (GET /artisans/:uid).
    const noAuthPatch = await app.request(
      "/artisans/me",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeName: "x" }) },
      env,
    );
    assert(noAuthPatch.status === 401, `artisans/me without auth should be 401, got ${noAuthPatch.status}`);

    const patchProfile = await app.request(
      "/artisans/me",
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ storeName: "Umunezero Handicrafts", storeBio: "Handwoven baskets and beadwork from the Eastern Province.", storeRegion: "Eastern Province", specialties: ["Baskets", "Beadwork"] }) },
      env,
    );
    assert(patchProfile.status === 200, `artisans/me patch failed with ${patchProfile.status}`);
    const patchedProfile = (await patchProfile.json()) as { user: { storeName: string | null; storeRegion: string | null; specialties: string[] } };
    assert(patchedProfile.user.storeName === "Umunezero Handicrafts", "storeName not persisted");
    assert(patchedProfile.user.storeRegion === "Eastern Province", "storeRegion not persisted");
    assert(patchedProfile.user.specialties.length === 2 && patchedProfile.user.specialties[1] === "Beadwork", "specialties not persisted");

    const clearStore = await app.request(
      "/artisans/me",
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ storeBio: "", specialties: [] }) },
      env,
    );
    const cleared = (await clearStore.json()) as { user: { storeBio: string | null; specialties: string[] } };
    assert(cleared.user.storeBio === null && cleared.user.specialties.length === 0, "empty strings should clear store fields");

    const tooLongName = await app.request(
      "/artisans/me",
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ storeName: "x".repeat(61) }) },
      env,
    );
    assert(tooLongName.status === 400, `oversized storeName should be 400, got ${tooLongName.status}`);

    const tooManySpecialties = await app.request(
      "/artisans/me",
      { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ specialties: Array.from({ length: 11 }, (_, i) => `s${i}`) }) },
      env,
    );
    assert(tooManySpecialties.status === 400, `11 specialties should be 400, got ${tooManySpecialties.status}`);

    const storefront = await app.request("/artisans/artisan-1", {}, env);
    assert(storefront.status === 200, `GET /artisans/artisan-1 failed with ${storefront.status}`);
    const sf = (await storefront.json()) as {
      artisan: { storeName: string | null; isVerifiedSeller: boolean; joinedAt: string };
      products: Array<{ id: string; title: string; productType: string; status: string }>;
      page: number;
      pageSize: number;
      hasMore: boolean;
    };
    assert(sf.artisan.storeName === "Umunezero Handicrafts", "storefront should reflect updated storeName");
    assert(sf.artisan.isVerifiedSeller === false, "artisan without verification should not be verified");
    assert(sf.products.length === 5, `storefront should list 5 active products, got ${sf.products.length}`);
    const sfDump = JSON.stringify(sf.products[0]);
    assert(sf.products[0]!.title === "Commissioned Beaded Necklace", `newest product should be first on the storefront, first=${sfDump}`);
    assert(sf.products.every((p) => p.status === "active"), "storefront should only list active products");
    const byType = new Set(sf.products.map((p) => p.productType));
    assert(byType.has("made_to_order") && byType.has("ready_to_ship"), "storefront should include both listing kinds");

    const page1 = await app.request("/artisans/artisan-1?pageSize=2", {}, env);
    const page1Body = (await page1.json()) as { products: unknown[]; pageSize: number; hasMore: boolean };
    assert(page1Body.products.length === 2 && page1Body.hasMore === true, "pageSize=2 should page the storefront");
    const page2 = await app.request("/artisans/artisan-1?pageSize=2&page=2", {}, env);
    const page2Body = (await page2.json()) as { page: number; products: unknown[]; pageSize: number };
    assert(page2Body.page === 2 && page2Body.products.length === 2, "page 2 should have 2 products");

    const notFound = await app.request("/artisans/unknown-user", {}, env);
    assert(notFound.status === 404, `unknown artisan should be 404, got ${notFound.status}`);

    // 7h. Featured artisans list (GET /artisans) — shops only, capped by limit.
    const artisanList = await app.request("/artisans?limit=5", {}, env);
    assert(artisanList.status === 200, `GET /artisans failed with ${artisanList.status}`);
    const artisanListBody = (await artisanList.json()) as {
      artisans: Array<{ uid: string; storeName: string | null; specialties: string[]; isVerifiedSeller: boolean }>;
    };
    assert(Array.isArray(artisanListBody.artisans), "GET /artisans should return an artisans array");
    assert(artisanListBody.artisans.length <= 5, `GET /artisans?limit=5 should cap results, got ${artisanListBody.artisans.length}`);
    assert(
      artisanListBody.artisans.every((a) => typeof a.uid === "string" && Array.isArray(a.specialties)),
      "featured artisans should carry uid + specialties",
    );
    const featured = artisanListBody.artisans.find((a) => a.uid === "artisan-1");
    assert(
      !!featured && featured.storeName === "Umunezero Handicrafts",
      "featured artisans should include the shop with a storefront profile",
    );

    // Cleanup: hide the extra products.
    for (const product of [phone12Mini, phone13Pro, galaxy, basket, necklace]) {
      const rm = await app.request(
        `/products/${product.id}`,
        { method: "PATCH", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "removed" }) },
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
        headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" },
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
      assert(upload.key.startsWith("uploads/artisan-1/"), `key should be user-scoped: ${upload.key}`);
      const url = new URL(upload.url);
      assert(url.host === "test-account.r2.cloudflarestorage.com", `unexpected presign host: ${url.host}`);
      assert(url.searchParams.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256", "missing X-Amz-Algorithm");
      assert(/^[0-9a-f]{64}$/.test(url.searchParams.get("X-Amz-Signature") ?? ""), "missing signature");
      assert(url.searchParams.get("X-Amz-Expires") === "900", "expected 900s expiry");
    }

    // 10. Presign: validation failures.
    const badMime = await app.request(
      "/uploads/presign",
      { method: "POST", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ files: [{ contentType: "text/html", size: 10 }] }) },
      env,
    );
    assert(badMime.status === 400, `expected 400 for bad mime, got ${badMime.status}`);

    const tooBig = await app.request(
      "/uploads/presign",
      { method: "POST", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ files: [{ contentType: "image/jpeg", size: 6 * 1024 * 1024 }] }) },
      env,
    );
    assert(tooBig.status === 400, `expected 400 for oversized image, got ${tooBig.status}`);

    const tooMany = await app.request(
      "/uploads/presign",
      { method: "POST", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ files: Array.from({ length: 7 }, () => ({ contentType: "image/jpeg", size: 10 })) }) },
      env,
    );
    assert(tooMany.status === 400, `expected 400 for >6 images, got ${tooMany.status}`);

    // 11. Presign without R2 creds -> 503.
    const noCreds = await app.request(
      "/uploads/presign",
      { method: "POST", headers: { Authorization: `Bearer ${artisanToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ files: [{ contentType: "image/jpeg", size: 10 }] }) },
      { ...env, R2_ACCOUNT_ID: undefined },
    );
    assert(noCreds.status === 503, `expected 503 without R2 creds, got ${noCreds.status}`);

    // 12. Media serving.
    const mediaKey = "uploads/artisan-1/22222222-2222-2222-2222-222222222222.jpg";
    mediaStore.set(mediaKey, "image/jpeg");
    const mediaRes = await app.request(`/media/${mediaKey}`, {}, env);
    assert(mediaRes.status === 200, `expected 200 for media, got ${mediaRes.status}`);
    assert(mediaRes.headers.get("Content-Type") === "image/jpeg", "media content-type mismatch");
    assert(mediaRes.headers.get("Cache-Control")?.includes("immutable"), "media should be cached as immutable");

    const mediaMissing = await app.request("/media/nope.jpg", {}, env);
    assert(mediaMissing.status === 404, `expected 404 for missing media, got ${mediaMissing.status}`);

    console.log(
      "PRODUCT TESTS PASSED (auth on create/presign, validation, public feed + filters (type/tags/materials/region/search/price/sort), detail with artisan info, artisan-only patch, per-type PATCH rules, artisan storefront + featured list, removed hides, presign batch + limits, media serving)",
    );
  } finally {
    jwksServer.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
