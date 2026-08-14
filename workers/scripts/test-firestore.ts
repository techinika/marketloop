// Verifies the Firestore REST client helpers (createDoc / getDoc / updateDoc /
// queryCollection) against an in-memory mock of the Firestore REST API.
//
// Run with: npm run test:firestore

import { FirestoreClient, decodeValue, type FirestoreDocument, type FirestoreField } from "../src/lib/firestore";
import { collections, type Product, type User } from "../src/models";

const PROJECT_ID = "marketloop-rw";
const API_URL = "http://firestore.local/v1";

interface StoredDoc {
  fields: Record<string, FirestoreField>;
  createTime: string;
  updateTime: string;
}

const store = new Map<string, StoredDoc>();

const TIME = "2026-08-13T00:00:00Z";

function docName(path: string): string {
  return `projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
}

function docJson(path: string, doc: StoredDoc): FirestoreDocument {
  return { name: docName(path), fields: doc.fields, createTime: doc.createTime, updateTime: doc.updateTime };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fakeFetch: typeof fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input));
  const segments = url.pathname.split("/").filter(Boolean);
  const documentsIdx = segments.indexOf("documents");
  const rest = segments.slice(documentsIdx + 1).join("/");
  const method = init?.method ?? "GET";
  const body = init?.body ? (JSON.parse(String(init?.body)) as { fields?: Record<string, FirestoreField>; name?: string; structuredQuery?: { from: Array<{ collectionId: string }>; where?: { fieldFilter?: unknown; compositeFilter?: { filters: Array<{ fieldFilter: { field: { fieldPath: string }; value: FirestoreField } }> } }; orderBy?: Array<{ field: { fieldPath: string }; direction: string }>; limit?: number; offset?: number } }) : null;

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
    return jsonResponse(
      entries.map(([path, doc]) => ({ document: docJson(path, doc), readTime: TIME })),
    );
  }

  if (method === "POST" && !rest.includes("/")) {
    const documentId = url.searchParams.get("documentId");
    if (!documentId) return jsonResponse({ error: "missing documentId" }, 400);
    const path = `${rest}/${documentId}`;
    if (store.has(path)) return jsonResponse({ error: "already exists" }, 409);
    store.set(path, { fields: body?.fields ?? {}, createTime: TIME, updateTime: TIME });
    return jsonResponse(docJson(path, store.get(path)!));
  }

  if (method === "GET") {
    const doc = store.get(rest);
    if (!doc) {
      return jsonResponse({ error: { code: 404, message: "Document not found.", status: "NOT_FOUND" } }, 404);
    }
    return jsonResponse(docJson(rest, doc));
  }

  if (method === "PATCH") {
    const doc = store.get(rest);
    if (!doc) {
      return jsonResponse({ error: { code: 404, message: "Document not found.", status: "NOT_FOUND" } }, 404);
    }
    doc.fields = { ...doc.fields, ...(body?.fields ?? {}) };
    doc.updateTime = TIME;
    return jsonResponse(docJson(rest, doc));
  }

  if (method === "DELETE") {
    store.delete(rest);
    return new Response(null, { status: 204 });
  }

  return jsonResponse({ error: "unsupported" }, 400);
}) as typeof fetch;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main(): Promise<void> {
  globalThis.fetch = fakeFetch;

  const db = new FirestoreClient({
    projectId: PROJECT_ID,
    clientEmail: "test@example.com",
    privateKey: "test-key",
    apiUrl: API_URL,
    accessTokenProvider: async () => "test-access-token",
  });

  const now = "2026-08-13T00:00:00.000Z";

  const createdUser = await db.createDoc<User>(collections.users, "seed-user-001", {
    uid: "seed-user-001",
    name: "Seed Seller",
    email: "seller@example.com",
    photoUrl: null,
    phone: null,
    walletBalance: 0,
    createdAt: now,
    rating: null,
  });
  assert(createdUser.id === "seed-user-001", "createDoc id mismatch");
  assert(createdUser.walletBalance === 0, "walletBalance should default to 0");

  const gotUser = await db.getDoc<User>(`${collections.users}/seed-user-001`);
  assert(gotUser?.email === "seller@example.com", "getDoc email mismatch");
  assert(gotUser?.name === "Seed Seller", "getDoc name mismatch");

  const missing = await db.getDoc<User>(`${collections.users}/nope`);
  assert(missing === null, "getDoc should return null for missing doc");

  const updatedUser = await db.updateDoc<User>(`${collections.users}/seed-user-001`, {
    walletBalance: 5000,
  });
  assert(updatedUser.walletBalance === 5000, "updateDoc walletBalance mismatch");
  const reRead = await db.getDoc<User>(`${collections.users}/seed-user-001`);
  assert(reRead?.walletBalance === 5000, "update was not persisted");

  const createdProduct = await db.createDoc<Product>(collections.products, "seed-product-001", {
    sellerId: "seed-user-001",
    title: "Sample Second-hand Laptop",
    description: "A gently used laptop.",
    category: "Electronics",
    titleKeywords: ["sample", "second", "hand", "laptop"],
    priceAmount: 250000,
    priceCurrency: "RWF",
    isNegotiable: true,
    isBiddingEnabled: false,
    conditionNote: "used 8 months",
    images: ["https://r2.example.dev/seed/product-001/1.jpg"],
    videoUrl: null,
    deliveryFee: 2000,
    deliveryFeePayer: "buyer",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  assert(createdProduct.id === "seed-product-001", "product createDoc id mismatch");
  assert(Array.isArray(createdProduct.images) && createdProduct.images.length === 1, "images array not persisted");

  const active = await db.queryCollection<Product>(collections.products, {
    filters: [{ field: "status", op: "==", value: "active" }],
    orderBy: { field: "createdAt", direction: "DESCENDING" },
    limit: 5,
  });
  assert(active.length === 1, `expected 1 active product, got ${active.length}`);
  assert(active[0]?.title === "Sample Second-hand Laptop", "query result title mismatch");
  assert(active[0]?.priceCurrency === "RWF", "query result currency mismatch");

  const secondPage = await db.queryCollection<Product>(collections.products, {
    filters: [{ field: "status", op: "==", value: "active" }],
    orderBy: { field: "createdAt", direction: "DESCENDING" },
    offset: 1,
    limit: 5,
  });
  assert(secondPage.length === 0, `expected 0 results after offset 1, got ${secondPage.length}`);

  const updatedProduct = await db.createDoc<Product>(collections.products, "seed-product-002", {
    sellerId: "seed-user-001",
    title: "Another Item",
    description: "Second product.",
    category: "Home",
    titleKeywords: ["another", "item"],
    priceAmount: 100,
    priceCurrency: "USD",
    isNegotiable: false,
    isBiddingEnabled: true,
    conditionNote: "new",
    images: ["https://r2.example.dev/seed/product-002/1.jpg"],
    videoUrl: null,
    deliveryFee: 0,
    deliveryFeePayer: "seller",
    status: "active",
    createdAt: "2026-08-13T00:00:01.000Z",
    updatedAt: "2026-08-13T00:00:01.000Z",
  });
  assert(updatedProduct.id === "seed-product-002", "second product createDoc id mismatch");

  const page1 = await db.queryCollection<Product>(collections.products, {
    filters: [{ field: "status", op: "==", value: "active" }],
    orderBy: { field: "createdAt", direction: "DESCENDING" },
    limit: 1,
  });
  assert(page1.length === 1, "page 1 should have 1 result");
  assert(page1[0]?.id === "seed-product-002", "newest product should be first on page 1");

  const page2 = await db.queryCollection<Product>(collections.products, {
    filters: [{ field: "status", op: "==", value: "active" }],
    orderBy: { field: "createdAt", direction: "DESCENDING" },
    offset: 1,
    limit: 1,
  });
  assert(page2.length === 1, "page 2 should have 1 result");
  assert(page2[0]?.id === "seed-product-001", "second newest product should be on page 2");

  console.log(
    "FIRESTORE TESTS PASSED (createDoc, getDoc, updateDoc, queryCollection, offset pagination, encode/decode round-trip)",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
