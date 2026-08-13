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
    const collectionId = rest.slice(0, -":runQuery".length);
    const q = body?.structuredQuery;
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function bearer(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
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
