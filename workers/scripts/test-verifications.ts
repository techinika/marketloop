// End-to-end route tests for account verification (phone OTP + ID documents).
//
// Follows the established test pattern: mock JWKS for Firebase tokens, an
// in-memory Firestore REST mock, an R2 stub, and an in-memory KV namespace,
// all behind the real Hono app.
//
// Run with: npm run test:verifications

import { createServer } from "node:http";

import app from "../src/index";
import { FirestoreClient, type FirestoreDocument, type FirestoreField } from "../src/lib/firestore";
import { collections, type User } from "../src/models";

const PROJECT_ID = "marketloop-rw";
const JWKS_PORT = 8801;
const JWKS_URL = `http://127.0.0.1:${JWKS_PORT}/jwks`;
const KID = "test-kid-ver";
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
  if (!field) return undefined;
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
    const collectionId = rest.slice(0, -":runQuery".length);
    const q = body?.structuredQuery;
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

// ---- R2 + KV binding stubs -------------------------------------------------

const mediaStore = new Map<string, string>();
const fakeImages: R2Bucket = {
  get: async () => null,
} as unknown as R2Bucket;

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
      sub: "user-1",
      name: "Verification User",
      email: "user@example.com",
      auth_time: now - 60,
      iat: now - 60,
      exp: now + 3600,
    };
    const userToken = await mintToken(claims, privateKey);
    const adminToken = await mintToken({ ...claims, sub: "admin-1", name: "Admin" }, privateKey);

    const db = new FirestoreClient({
      projectId: PROJECT_ID,
      clientEmail: "test@example.com",
      privateKey: "test-key",
      apiUrl: API_URL,
      accessTokenProvider: async () => "test-access-token",
    });
    await db.createDoc<User>(collections.users, "user-1", {
      uid: "user-1",
      name: "Verification User",
      email: "user@example.com",
      photoUrl: null,
      phone: null,
      walletBalance: 0,
      createdAt: new Date(now * 1000).toISOString(),
      rating: null,
    });
    await db.createDoc<User>(collections.users, "admin-1", {
      uid: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      photoUrl: null,
      phone: null,
      walletBalance: 0,
      createdAt: new Date(now * 1000).toISOString(),
      rating: null,
      isAdmin: true,
    });

    const PHONE = "+250788123456";

    // 1. Auth required everywhere.
    const noAuth = await app.request("/verifications/phone/request", { method: "POST", body: JSON.stringify({ phone: PHONE }) }, env);
    assert(noAuth.status === 401, `phone/request without token should be 401, got ${noAuth.status}`);
    const noAuthId = await app.request("/verifications/id/request", { method: "POST", body: JSON.stringify({}) }, env);
    assert(noAuthId.status === 401, `id/request without token should be 401, got ${noAuthId.status}`);
    const meNoAuth = await app.request("/verifications/me", {}, env);
    assert(meNoAuth.status === 401, `verifications/me without token should be 401, got ${meNoAuth.status}`);

    const authed = { headers: { Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" } };

    // 2. Phone request: validation + success + rate limit.
    const badPhone = await app.request("/verifications/phone/request", { method: "POST", headers: authed.headers, body: JSON.stringify({ phone: "250788123456" }) }, env);
    assert(badPhone.status === 400, `invalid phone should be 400, got ${badPhone.status}`);

    const reqRes = await app.request("/verifications/phone/request", { method: "POST", headers: authed.headers, body: JSON.stringify({ phone: PHONE }) }, env);
    assert(reqRes.status === 200, `phone request should be 200, got ${reqRes.status}`);
    const reqBody = (await reqRes.json()) as { message: string; resendInSeconds: number };
    assert(reqBody.resendInSeconds === 60, `resendInSeconds should be 60, got ${reqBody.resendInSeconds}`);

    const rateLimit = await app.request("/verifications/phone/request", { method: "POST", headers: authed.headers, body: JSON.stringify({ phone: PHONE }) }, env);
    assert(rateLimit.status === 429, `immediate resend should be 429, got ${rateLimit.status}`);

    const stored = kvStore.get("otp:user-1");
    assert(stored !== undefined, "OTP should be stored in KV");
    const otp = (JSON.parse(stored!) as { code: string; phone: string }).code;
    assert(/^\d{6}$/.test(otp), `OTP should be 6 digits, got ${otp}`);

    // 3. Phone confirm: wrong code, then correct code.
    const wrongCode = await app.request("/verifications/phone/confirm", { method: "POST", headers: authed.headers, body: JSON.stringify({ phone: PHONE, code: "000000" }) }, env);
    assert(wrongCode.status === 400, `wrong code should be 400, got ${wrongCode.status}`);
    const wrongBody = (await wrongCode.json()) as { attemptsLeft: number };
    assert(wrongBody.attemptsLeft === 4, `attemptsLeft should be 4, got ${wrongBody.attemptsLeft}`);

    const confirmRes = await app.request("/verifications/phone/confirm", { method: "POST", headers: authed.headers, body: JSON.stringify({ phone: PHONE, code: otp }) }, env);
    assert(confirmRes.status === 200, `correct code should be 200, got ${confirmRes.status}`);
    const confirmBody = (await confirmRes.json()) as { phoneVerifiedAt: string };
    assert(typeof confirmBody.phoneVerifiedAt === "string", "phoneVerifiedAt should be returned");
    assert(kvStore.get("otp:user-1") === undefined, "OTP should be deleted after use");

    const userAfter = await db.getDoc<User>(`${collections.users}/user-1`);
    assert(userAfter?.phone === PHONE, "phone should be persisted on the user");
    assert(Boolean(userAfter?.phoneVerifiedAt), "phoneVerifiedAt should be set");

    // Re-confirm with the same (now deleted) code -> expired.
    const reuse = await app.request("/verifications/phone/confirm", { method: "POST", headers: authed.headers, body: JSON.stringify({ phone: PHONE, code: otp }) }, env);
    assert(reuse.status === 400, `reusing a consumed code should be 400, got ${reuse.status}`);

    // 4. ID presign: validation + user-scoped key.
    const presignRes = await app.request("/verifications/id/presign", { method: "POST", headers: authed.headers, body: JSON.stringify({ contentType: "image/jpeg", size: 1024 }) }, env);
    assert(presignRes.status === 200, `id presign should be 200, got ${presignRes.status}`);
    const presignBody = (await presignRes.json()) as { key: string; url: string; expiresInSeconds: number };
    assert(presignBody.key.startsWith("id-documents/user-1/"), `key should be user-scoped, got ${presignBody.key}`);
    assert(new URL(presignBody.url).searchParams.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256", "presign should be SigV4");

    const badMime = await app.request("/verifications/id/presign", { method: "POST", headers: authed.headers, body: JSON.stringify({ contentType: "text/html", size: 10 }) }, env);
    assert(badMime.status === 400, `bad mime should be 400, got ${badMime.status}`);

    const tooBig = await app.request("/verifications/id/presign", { method: "POST", headers: authed.headers, body: JSON.stringify({ contentType: "image/png", size: 6 * 1024 * 1024 }) }, env);
    assert(tooBig.status === 400, `oversized ID should be 400, got ${tooBig.status}`);

    const noCreds = await app.request("/verifications/id/presign", { method: "POST", headers: authed.headers, body: JSON.stringify({ contentType: "image/png", size: 10 }) }, { ...env, R2_ACCOUNT_ID: undefined });
    assert(noCreds.status === 503, `no R2 creds should be 503, got ${noCreds.status}`);

    // 5. ID submission.
    const badKey = await app.request("/verifications/id/request", { method: "POST", headers: authed.headers, body: JSON.stringify({ documentType: "passport", key: "uploads/user-1/foo.jpg" }) }, env);
    assert(badKey.status === 400, `foreign key prefix should be 400, got ${badKey.status}`);

    const submitRes = await app.request("/verifications/id/request", { method: "POST", headers: authed.headers, body: JSON.stringify({ documentType: "passport", key: presignBody.key }) }, env);
    assert(submitRes.status === 200, `id submission should be 200, got ${submitRes.status}`);
    const submitBody = (await submitRes.json()) as { verificationStatus: string };
    assert(submitBody.verificationStatus === "pending", `status should be pending, got ${submitBody.verificationStatus}`);

    const resubmit = await app.request("/verifications/id/request", { method: "POST", headers: authed.headers, body: JSON.stringify({ documentType: "passport", key: presignBody.key }) }, env);
    assert(resubmit.status === 409, `resubmit while pending should be 409, got ${resubmit.status}`);

    // 6. /verifications/me reflects state.
    const meRes = await app.request("/verifications/me", { headers: { Authorization: `Bearer ${userToken}` } }, env);
    assert(meRes.status === 200, `verifications/me should be 200, got ${meRes.status}`);
    const me = (await meRes.json()) as { phoneVerifiedAt: string | null; verificationStatus: string; idDocumentType: string };
    assert(Boolean(me.phoneVerifiedAt), "me should report phone verified");
    assert(me.verificationStatus === "pending", `me should report pending, got ${me.verificationStatus}`);
    assert(me.idDocumentType === "passport", "me should report document type");

    // /auth/me surfaces verification fields too.
    const authMe = await app.request("/auth/me", { headers: { Authorization: `Bearer ${userToken}` } }, env);
    const authMeBody = (await authMe.json()) as { user: { verificationStatus: string; phoneVerifiedAt: string | null } };
    assert(authMeBody.user.verificationStatus === "pending", "auth/me should include verificationStatus");
    assert(Boolean(authMeBody.user.phoneVerifiedAt), "auth/me should include phoneVerifiedAt");

    // Signed URL for the user's own document.
    const signUrl = await app.request("/verifications/me/id/sign-url", { method: "POST", headers: { Authorization: `Bearer ${userToken}` } }, env);
    assert(signUrl.status === 200, `sign-url should be 200, got ${signUrl.status}`);
    const signUrlBody = (await signUrl.json()) as { url: string };
    assert(new URL(signUrlBody.url).pathname.includes("id-documents/user-1/"), "signed URL should point at the user's doc");

    // 7. Admin: non-admin is blocked.
    const adminHeaders = { headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" } };
    const nonAdmin = await app.request("/admin/verifications/pending", { headers: { Authorization: `Bearer ${userToken}` } }, env);
    assert(nonAdmin.status === 403, `non-admin pending list should be 403, got ${nonAdmin.status}`);

    const pendingRes = await app.request("/admin/verifications/pending", { headers: { Authorization: `Bearer ${adminToken}` } }, env);
    assert(pendingRes.status === 200, `admin pending list should be 200, got ${pendingRes.status}`);
    const pendingBody = (await pendingRes.json()) as {
      verifications: Array<{ uid: string; name: string; idDocumentType: string; phoneVerified: boolean; documentUrl: string | null }>;
    };
    assert(pendingBody.verifications.length === 1, `expected 1 pending, got ${pendingBody.verifications.length}`);
    assert(pendingBody.verifications[0]!.uid === "user-1", "pending row should be user-1");
    assert(pendingBody.verifications[0]!.phoneVerified === true, "pending row should show phone verified");
    assert(pendingBody.verifications[0]!.documentUrl !== null, "pending row should include a signed document URL");

    const approveRes = await app.request("/admin/verifications/user-1/approve", { method: "POST", headers: adminHeaders.headers, body: JSON.stringify({}) }, env);
    assert(approveRes.status === 200, `approve should be 200, got ${approveRes.status}`);
    const approved = (await approveRes.json()) as { user: User };
    assert(approved.user.verificationStatus === "verified", "approve should set verified");

    const approveAgain = await app.request("/admin/verifications/user-1/approve", { method: "POST", headers: adminHeaders.headers, body: JSON.stringify({}) }, env);
    assert(approveAgain.status === 409, `double approve should be 409, got ${approveAgain.status}`);

    const approvedList = await app.request("/admin/verifications/pending", { headers: { Authorization: `Bearer ${adminToken}` } }, env);
    const approvedListBody = (await approvedList.json()) as { verifications: unknown[] };
    assert(approvedListBody.verifications.length === 0, "pending list should be empty after approve");

    // A notification should have been created for the user.
    const notifications = [...store.entries()].filter(([key]) => key.startsWith("notifications/"));
    assert(notifications.length >= 1, "approve should notify the user");
    const notifFields = notifications[0]![1].fields;
    const notif = Object.fromEntries(
      Object.entries(notifFields).map(([k, v]) => [k, decodeValue(v)]),
    ) as { userId: string; type: string };
    assert(notif.userId === "user-1", "notification should target the user");
    assert(notif.type === "verification_approved", `notification type should be verification_approved, got ${notif.type}`);

    // 8. Rejection flow for a second user.
    await db.createDoc<User>(collections.users, "user-2", {
      uid: "user-2",
      name: "Second User",
      email: "user2@example.com",
      photoUrl: null,
      phone: null,
      walletBalance: 0,
      createdAt: new Date(now * 1000).toISOString(),
      rating: null,
    });
    await db.updateDoc<User>(`${collections.users}/user-2`, {
      idDocumentType: "national_id",
      idDocumentKey: "id-documents/user-2/aaa.jpg",
      verificationStatus: "pending",
      verificationSubmittedAt: new Date(now * 1000).toISOString(),
    });

    const rejectNoReason = await app.request("/admin/verifications/user-2/reject", { method: "POST", headers: adminHeaders.headers, body: JSON.stringify({}) }, env);
    assert(rejectNoReason.status === 400, `reject without reason should be 400, got ${rejectNoReason.status}`);

    const rejectRes = await app.request("/admin/verifications/user-2/reject", { method: "POST", headers: adminHeaders.headers, body: JSON.stringify({ reason: "Photo is blurry" }) }, env);
    assert(rejectRes.status === 200, `reject should be 200, got ${rejectRes.status}`);
    const rejected = (await rejectRes.json()) as { user: User };
    assert(rejected.user.verificationStatus === "rejected", "reject should set rejected");
    assert(rejected.user.verificationNote === "Photo is blurry", "reject should store the reason");

    console.log(
      "VERIFICATION TESTS PASSED (auth gate, OTP request/confirm + rate limit + single-use, ID presign + submit, /verifications/me, admin pending/approve/reject + notifications)",
    );
  } finally {
    jwksServer.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
